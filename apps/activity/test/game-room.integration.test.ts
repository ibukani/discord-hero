import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { CURRENT_CONTENT } from "@discord-hero/content";
import {
  GAME_WEBSOCKET_PROTOCOL,
  PROTOCOL_VERSION,
  parseServerMessage,
  type ServerMessage,
} from "@discord-hero/protocol";
import { describe, expect, it } from "vitest";
import {
  issueRoomTicket,
  issueSessionToken,
  verifySessionToken,
} from "../src/worker/auth/tokens.js";
import { type GameRoom } from "../src/worker/durable-objects/GameRoom.js";
import {
  COMPLETION_OUTBOX_STORAGE_KEY,
  RESULT_QUEUED_PREFIX,
  ROOM_LIFECYCLE_STORAGE_KEY,
} from "../src/worker/durable-objects/completion-outbox.js";
import { MAX_ROOM_CONNECTIONS } from "../src/worker/durable-objects/room-connections.js";

const SIGNING_SECRET = "test-signing-secret-with-at-least-32-characters";

describe("GameRoom integration", () => {
  it("accepts a validated WebSocket and rejects ticket replay", async () => {
    const roomId = "integration-room-ticket";
    const stub = roomStub(roomId);
    const ticket = await createRoomTicket(roomId, "player-one", "Player One");
    const firstResponse = await connect(stub, roomId, ticket);
    const socket = requireWebSocket(firstResponse);
    socket.accept();

    const replayResponse = await connect(stub, roomId, ticket);
    expect(replayResponse.status).toBe(401);
    await replayResponse.text();

    socket.close(1000, "test complete");
  });

  it("restores a joined player from a persisted checkpoint after eviction", async () => {
    const roomId = "integration-room-restore";
    const stub = roomStub(roomId);
    const firstTicket = await createRoomTicket(roomId, "player-one", "Player One");
    const firstResponse = await connect(stub, roomId, firstTicket);
    const firstSocket = requireWebSocket(firstResponse);
    firstSocket.accept();

    const firstWelcomePromise = nextMessage(firstSocket, (message) => message.type === "welcome");
    firstSocket.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: "hello",
        actionId: "hello-first",
        classId: "guardian",
        rulesetVersion: CURRENT_CONTENT.rulesetVersion,
        contentVersion: CURRENT_CONTENT.version,
        lastStateRevision: null,
      }),
    );
    const firstWelcome = await firstWelcomePromise;
    expect(firstWelcome.type).toBe("welcome");
    if (firstWelcome.type !== "welcome") {
      throw new Error("Expected welcome message");
    }
    expect(Object.keys(firstWelcome.snapshot.players)).toEqual(["player-one"]);

    await runInDurableObject(stub, async (_instance: GameRoom, state) => {
      const snapshot = await state.storage.get("room-snapshot");
      expect(snapshot).toBeDefined();
    });

    await evictDurableObject(stub, { webSockets: "close" });

    const secondTicket = await createRoomTicket(roomId, "player-one", "Player One");
    const secondResponse = await connect(stub, roomId, secondTicket);
    const secondSocket = requireWebSocket(secondResponse);
    secondSocket.accept();

    const secondWelcomePromise = nextMessage(secondSocket, (message) => message.type === "welcome");
    secondSocket.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: "hello",
        actionId: "hello-second",
        classId: "guardian",
        rulesetVersion: CURRENT_CONTENT.rulesetVersion,
        contentVersion: CURRENT_CONTENT.version,
        lastStateRevision: firstWelcome.stateRevision,
      }),
    );
    const secondWelcome = await secondWelcomePromise;
    expect(secondWelcome.type).toBe("welcome");
    if (secondWelcome.type !== "welcome") {
      throw new Error("Expected restored welcome message");
    }
    expect(Object.keys(secondWelcome.snapshot.players)).toEqual(["player-one"]);
    expect(secondWelcome.snapshot.matchId).toBe(firstWelcome.snapshot.matchId);

    secondSocket.close(1000, "test complete");
  });

  it("restores room identity while a WebSocket hibernates", async () => {
    const roomId = "integration-room-hibernation";
    const stub = roomStub(roomId);
    const ticket = await createRoomTicket(roomId, "player-one", "Player One");
    const response = await connect(stub, roomId, ticket);
    const socket = requireWebSocket(response);
    socket.accept();

    const firstWelcomePromise = nextMessage(socket, (message) => message.type === "welcome");
    socket.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: "hello",
        actionId: "hello-before-hibernation",
        classId: "guardian",
        rulesetVersion: CURRENT_CONTENT.rulesetVersion,
        contentVersion: CURRENT_CONTENT.version,
        lastStateRevision: null,
      }),
    );
    await firstWelcomePromise;

    await evictDurableObject(stub, { webSockets: "hibernate" });

    const restoredWelcomePromise = nextMessage(socket, (message) => message.type === "welcome");
    socket.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: "hello",
        actionId: "hello-after-hibernation",
        classId: "guardian",
        rulesetVersion: CURRENT_CONTENT.rulesetVersion,
        contentVersion: CURRENT_CONTENT.version,
        lastStateRevision: null,
      }),
    );
    const restoredWelcome = await restoredWelcomePromise;
    expect(restoredWelcome.type).toBe("welcome");
    if (restoredWelcome.type !== "welcome") {
      throw new Error("Expected welcome message after hibernation");
    }
    expect(restoredWelcome.roomId).toBe(roomId);

    socket.close(1000, "test complete");
  });

  it("acknowledges accepted commands and serves an explicit resync snapshot", async () => {
    const roomId = "integration-room-ack";
    const stub = roomStub(roomId);
    const ticket = await createRoomTicket(roomId, "player-one", "Player One");
    const response = await connect(stub, roomId, ticket);
    const socket = requireWebSocket(response);
    socket.accept();

    const welcomePromise = nextMessage(socket, (message) => message.type === "welcome");
    const helloAckPromise = nextMessage(
      socket,
      (message) => message.type === "command_ack" && message.actionId === "hello-ack",
    );
    socket.send(JSON.stringify(helloMessage("hello-ack", null)));
    const welcome = await welcomePromise;
    const helloAck = await helloAckPromise;
    expect(helloAck.type).toBe("command_ack");

    const snapshotPromise = nextMessage(socket, (message) => message.type === "snapshot");
    const syncAckPromise = nextMessage(
      socket,
      (message) => message.type === "command_ack" && message.actionId === "sync-1",
    );
    socket.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: "sync_request",
        actionId: "sync-1",
        lastStateRevision: welcome.stateRevision,
      }),
    );
    const snapshot = await snapshotPromise;
    const syncAck = await syncAckPromise;
    expect(snapshot.type).toBe("snapshot");
    expect(syncAck.type).toBe("command_ack");

    socket.close(1000, "test complete");
  });

  it("rejects a client with an unsupported content version", async () => {
    const roomId = "integration-room-content-mismatch";
    const stub = roomStub(roomId);
    const ticket = await createRoomTicket(roomId, "player-one", "Player One");
    const response = await connect(stub, roomId, ticket);
    const socket = requireWebSocket(response);
    socket.accept();

    const errorPromise = nextMessage(
      socket,
      (message) => message.type === "error" && message.code === "unsupported_content",
    );
    socket.send(
      JSON.stringify({
        ...helloMessage("hello-incompatible", null),
        contentVersion: "unknown-content",
      }),
    );

    const error = await errorPromise;
    expect(error.type).toBe("error");
  });

  it("enforces the per-player WebSocket connection limit", async () => {
    const roomId = "integration-room-connection-limit";
    const stub = roomStub(roomId);
    const firstResponse = await connect(
      stub,
      roomId,
      await createRoomTicket(roomId, "player-one", "Player One"),
    );
    const firstSocket = requireWebSocket(firstResponse);
    firstSocket.accept();
    const secondResponse = await connect(
      stub,
      roomId,
      await createRoomTicket(roomId, "player-one", "Player One"),
    );
    const secondSocket = requireWebSocket(secondResponse);
    secondSocket.accept();

    const rejected = await connect(
      stub,
      roomId,
      await createRoomTicket(roomId, "player-one", "Player One"),
    );
    expect(rejected.status).toBe(429);
    await rejected.text();

    firstSocket.close(1000, "test complete");
    secondSocket.close(1000, "test complete");
  });

  it("enforces the total room WebSocket connection limit", async () => {
    const roomId = "integration-room-total-limit";
    const stub = roomStub(roomId);
    const sockets: WebSocket[] = [];
    for (let index = 0; index < MAX_ROOM_CONNECTIONS; index += 1) {
      const response = await connect(
        stub,
        roomId,
        await createRoomTicket(roomId, `player-${index}`, `Player ${index}`),
      );
      const socket = requireWebSocket(response);
      socket.accept();
      sockets.push(socket);
    }

    const rejected = await connect(
      stub,
      roomId,
      await createRoomTicket(roomId, "overflow-player", "Overflow Player"),
    );
    expect(rejected.status).toBe(429);
    await rejected.text();

    for (const socket of sockets) {
      socket.close(1000, "test complete");
    }
  });

  it("does not replace an unsupported persisted snapshot with a new game", async () => {
    const roomId = "integration-room-invalid-recovery";
    const stub = roomStub(roomId);
    await runInDurableObject(stub, async (_instance: GameRoom, state) => {
      await state.storage.put("room-snapshot", {
        storageSchemaVersion: 999,
        matchId: "must-not-be-replaced",
      });
    });
    await evictDurableObject(stub, { webSockets: "close" });

    const response = await connect(
      stub,
      roomId,
      await createRoomTicket(roomId, "player-one", "Player One"),
    );
    expect(response.status).toBe(503);
    await response.text();
    await runInDurableObject(stub, async (_instance: GameRoom, state) => {
      const stored = await state.storage.get<{ readonly storageSchemaVersion: number }>(
        "room-snapshot",
      );
      expect(stored?.storageSchemaVersion).toBe(999);
    });
  });

  it("delivers a persisted completion outbox from an alarm before scheduling cleanup", async () => {
    const roomId = "integration-room-outbox-alarm";
    const matchId = "match-outbox-alarm";
    const stub = roomStub(roomId);
    await runInDurableObject(stub, async (_instance: GameRoom, state) => {
      await state.storage.put(COMPLETION_OUTBOX_STORAGE_KEY, {
        eventId: `${matchId}:finished`,
        matchId,
        rulesetVersion: CURRENT_CONTENT.rulesetVersion,
        contentVersion: CURRENT_CONTENT.version,
        seed: "outbox-seed",
        startedAt: "2026-07-25T00:00:00.000Z",
        endedAt: "2026-07-25T00:01:00.000Z",
        result: { outcome: "victory", durationMs: 60_000, completedAtTick: 600 },
        players: [],
      });
      await state.storage.setAlarm(Date.now() + 60_000);
    });

    let delivered = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      delivered = await runInDurableObject(stub, async (_instance: GameRoom, state) =>
        state.storage.get(COMPLETION_OUTBOX_STORAGE_KEY).then((stored) => stored === undefined),
      );
      if (delivered) {
        break;
      }
    }
    expect(delivered).toBe(true);

    await runInDurableObject(stub, async (_instance: GameRoom, state) => {
      expect(await state.storage.get(COMPLETION_OUTBOX_STORAGE_KEY)).toBeUndefined();
      expect(await state.storage.get(`${RESULT_QUEUED_PREFIX}${matchId}`)).toBe(true);
      expect(await state.storage.get(ROOM_LIFECYCLE_STORAGE_KEY)).toBeDefined();
    });
  });

  it("removes expired completed-room storage from an alarm", async () => {
    const roomId = "integration-room-cleanup-alarm";
    const stub = roomStub(roomId);
    await runInDurableObject(stub, async (_instance: GameRoom, state) => {
      await state.storage.put({
        [ROOM_LIFECYCLE_STORAGE_KEY]: { cleanupAtMs: 0 },
        "temporary-completed-state": { retained: true },
      });
      await state.storage.setAlarm(Date.now() + 60_000);
    });

    await runDurableObjectAlarm(stub);

    await runInDurableObject(stub, async (_instance: GameRoom, state) => {
      expect(await state.storage.list()).toEqual(new Map());
    });
  }, 15_000);
});

function roomStub(roomId: string): DurableObjectStub<GameRoom> {
  const canonicalKey = `local:test-discord-client:${roomId}`;
  return env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(canonicalKey));
}

async function createRoomTicket(
  roomId: string,
  userId: string,
  displayName: string,
): Promise<string> {
  const sessionToken = await issueSessionToken(userId, displayName, roomId, SIGNING_SECRET);
  const session = await verifySessionToken(sessionToken, SIGNING_SECRET);
  return (await issueRoomTicket(session, roomId, SIGNING_SECRET)).token;
}

function connect(stub: DurableObjectStub, roomId: string, ticket: string): Promise<Response> {
  return stub.fetch(
    new Request(`https://activity.test/api/rooms/${encodeURIComponent(roomId)}/socket`, {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": `${GAME_WEBSOCKET_PROTOCOL}, auth.${ticket}`,
      },
    }),
  );
}

function helloMessage(actionId: string, lastStateRevision: number | null): object {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "hello",
    actionId,
    classId: "guardian",
    rulesetVersion: CURRENT_CONTENT.rulesetVersion,
    contentVersion: CURRENT_CONTENT.version,
    lastStateRevision,
  };
}

function requireWebSocket(response: Response): WebSocket {
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) {
    throw new Error("Expected WebSocket upgrade response");
  }
  return socket;
}

function nextMessage(
  socket: WebSocket,
  predicate: (message: ServerMessage) => boolean,
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, 2_000);

    function onMessage(event: MessageEvent): void {
      try {
        const source = typeof event.data === "string" ? event.data : null;
        if (source === null) {
          return;
        }
        const message = parseServerMessage(JSON.parse(source) as unknown);
        if (!predicate(message)) {
          return;
        }
        clearTimeout(timeout);
        socket.removeEventListener("message", onMessage);
        resolve(message);
      } catch (error: unknown) {
        clearTimeout(timeout);
        socket.removeEventListener("message", onMessage);
        reject(error instanceof Error ? error : new Error("Failed to parse WebSocket message"));
      }
    }

    socket.addEventListener("message", onMessage);
  });
}

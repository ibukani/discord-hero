import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { PROTOCOL_VERSION, parseServerMessage, type ServerMessage } from "@discord-hero/protocol";
import { describe, expect, it } from "vitest";
import {
  issueRoomTicket,
  issueSessionToken,
  verifySessionToken,
} from "../src/worker/auth/tokens.js";
import { type GameRoom } from "../src/worker/durable-objects/GameRoom.js";

const SIGNING_SECRET = "test-signing-secret-with-at-least-32-characters";
const GAME_PROTOCOL = "discord-hero.v1";

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
        lastServerSequence: null,
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
        lastServerSequence: firstWelcome.serverSequence,
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
});

function roomStub(roomId: string): DurableObjectStub<GameRoom> {
  const canonicalKey = `local:test-discord-client:${roomId}`;
  return env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(canonicalKey)) as unknown as DurableObjectStub<GameRoom>;
}

async function createRoomTicket(
  roomId: string,
  userId: string,
  displayName: string,
): Promise<string> {
  const sessionToken = await issueSessionToken(userId, displayName, SIGNING_SECRET);
  const session = await verifySessionToken(sessionToken, SIGNING_SECRET);
  return (await issueRoomTicket(session, roomId, SIGNING_SECRET)).token;
}

function connect(stub: DurableObjectStub, roomId: string, ticket: string): Promise<Response> {
  return stub.fetch(
    new Request(`https://activity.test/api/rooms/${encodeURIComponent(roomId)}/socket`, {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": `${GAME_PROTOCOL}, auth.${ticket}`,
      },
    }),
  );
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

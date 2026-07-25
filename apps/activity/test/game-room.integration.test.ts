import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { CURRENT_CONTENT } from "@discord-hero/content";
import {
  actionId,
  applyCommand,
  createGame,
  matchId,
  playerId,
  type GameState,
} from "@discord-hero/game-core";
import {
  GAME_WEBSOCKET_PROTOCOL,
  PROTOCOL_VERSION,
  parseServerMessage,
  type StoredGameState,
  type ServerMessage,
} from "@discord-hero/protocol";
import { toStoredGameState } from "../src/worker/durable-objects/codec.js";
import { describe, expect, it } from "vitest";
import {
  issueRoomTicket,
  issueSessionToken,
  verifySessionToken,
} from "../src/worker/auth/tokens.js";
import {
  savePlayerPreferences,
  upsertPlayer,
} from "../src/worker/persistence/player-repository.js";
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

    const equipmentEventPromise = nextMessage(
      firstSocket,
      (message) =>
        message.type === "events" &&
        message.events.some((event) => event.type === "equipment_changed"),
    );
    const equipmentAckPromise = nextMessage(
      firstSocket,
      (message) => message.type === "command_ack" && message.actionId === "equipment-first",
    );
    firstSocket.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: "set_equipment",
        actionId: "equipment-first",
        weaponId: firstWelcome.snapshot.players["player-one"]?.loadout.weaponId,
        armorId: firstWelcome.snapshot.players["player-one"]?.loadout.armorId,
        accessoryId: firstWelcome.snapshot.players["player-one"]?.loadout.accessoryId,
      }),
    );
    const equipmentEvent = await equipmentEventPromise;
    await equipmentAckPromise;
    expect(equipmentEvent.type).toBe("events");

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
    expect(secondWelcome.snapshot.players["player-one"]?.loadout).toEqual(
      firstWelcome.snapshot.players["player-one"]?.loadout,
    );
    expect(secondWelcome.snapshot.players["player-one"]?.activeSynergyIds).toEqual([
      "barrier-vanguard",
    ]);

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

  it("restores the server-owned player profile and ignores a client class override", async () => {
    const player = "profile-player";
    const profileRoomId = "integration-room-profile-one";
    await upsertPlayer(env.DB, {
      id: player,
      discordUserId: null,
      displayName: "Profile Player",
      initialClassId: "mage",
      now: "2026-07-25T00:00:00.000Z",
    });

    const firstStub = roomStub(profileRoomId);
    const firstSocket = requireWebSocket(
      await connect(
        firstStub,
        profileRoomId,
        await createRoomTicket(profileRoomId, player, "Profile Player"),
      ),
    );
    firstSocket.accept();
    const firstWelcomePromise = nextMessage(firstSocket, (message) => message.type === "welcome");
    firstSocket.send(JSON.stringify(helloMessage("profile-hello-one", null)));
    const firstWelcome = await firstWelcomePromise;
    expect(firstWelcome.type).toBe("welcome");
    if (firstWelcome.type !== "welcome") {
      throw new Error("Expected first profile welcome");
    }
    expect(firstWelcome.snapshot.players[player]?.classId).toBe("mage");

    await sendAndWaitForAck(firstSocket, {
      protocolVersion: PROTOCOL_VERSION,
      type: "set_loadout",
      actionId: "profile-loadout",
      activeSkillIds: ["mage.arc_burst", "mage.chain_lightning"],
    });
    await sendAndWaitForAck(firstSocket, {
      protocolVersion: PROTOCOL_VERSION,
      type: "set_equipment",
      actionId: "profile-equipment",
      weaponId: "weapon.arcane-focus",
      armorId: "armor.ranger-cloak",
      accessoryId: "accessory.arcane-signet",
    });
    await sendAndWaitForAck(firstSocket, {
      protocolVersion: PROTOCOL_VERSION,
      type: "set_automation_policy",
      actionId: "profile-automation",
      policy: {
        growth: "skill",
        progress: "reward",
        retreat: "last_stand",
        rescue: "priority",
      },
    });
    firstSocket.close(1000, "profile saved");

    await env.DB.prepare(
      `UPDATE player_progress
       SET account_level = ?1, experience = ?2, game_currency = ?3
       WHERE player_id = ?4`,
    )
      .bind(3, 245, 321, player)
      .run();
    await env.DB.prepare(
      `INSERT INTO unlocks (player_id, unlock_type, content_id, unlocked_at)
       VALUES (?1, ?2, ?3, ?4)`,
    )
      .bind(player, "achievement", "achievement.workbench-victory", "2026-07-25T00:00:02.000Z")
      .run();

    const secondRoomId = "integration-room-profile-two";
    const secondStub = roomStub(secondRoomId);
    const secondSocket = requireWebSocket(
      await connect(
        secondStub,
        secondRoomId,
        await createRoomTicket(secondRoomId, player, "Profile Player"),
      ),
    );
    secondSocket.accept();
    const secondWelcomePromise = nextMessage(secondSocket, (message) => message.type === "welcome");
    secondSocket.send(JSON.stringify(helloMessage("profile-hello-two", null)));
    const secondWelcome = await secondWelcomePromise;
    expect(secondWelcome.type).toBe("welcome");
    if (secondWelcome.type !== "welcome") {
      throw new Error("Expected restored profile welcome");
    }
    expect(secondWelcome.accountProgress).toEqual({
      accountLevel: 3,
      experience: 245,
      nextLevelExperience: 300,
      gameCurrency: 321,
      unlockedContentIds: ["achievement.workbench-victory"],
    });
    const restoredPlayer = secondWelcome.snapshot.players[player];
    expect(restoredPlayer?.classId).toBe("mage");
    expect(restoredPlayer?.loadout).toEqual({
      activeSkillIds: ["mage.arc_burst", "mage.chain_lightning"],
      weaponId: "weapon.arcane-focus",
      armorId: "armor.ranger-cloak",
      accessoryId: "accessory.arcane-signet",
    });
    expect(restoredPlayer?.automation).toEqual({
      growth: "skill",
      progress: "reward",
      retreat: "last_stand",
      rescue: "priority",
    });
    secondSocket.close(1000, "profile restored");

    await env.DB.prepare(
      `UPDATE player_preferences
       SET class_id = ?1, loadout_json = ?2, automation_json = ?3
       WHERE player_id = ?4`,
    )
      .bind("unknown-class", "{broken", "[broken", player)
      .run();
    await env.DB.prepare("DELETE FROM player_progress WHERE player_id = ?1").bind(player).run();

    const thirdRoomId = "integration-room-profile-corrupt";
    const thirdStub = roomStub(thirdRoomId);
    const thirdSocket = requireWebSocket(
      await connect(
        thirdStub,
        thirdRoomId,
        await createRoomTicket(thirdRoomId, player, "Profile Player"),
      ),
    );
    thirdSocket.accept();
    const thirdWelcomePromise = nextMessage(thirdSocket, (message) => message.type === "welcome");
    thirdSocket.send(JSON.stringify(helloMessage("profile-hello-three", null)));
    const thirdWelcome = await thirdWelcomePromise;
    expect(thirdWelcome.type).toBe("welcome");
    if (thirdWelcome.type !== "welcome") {
      throw new Error("Expected fallback profile welcome");
    }
    const fallbackPlayer = thirdWelcome.snapshot.players[player];
    expect(fallbackPlayer?.classId).toBe("guardian");
    expect(fallbackPlayer?.loadout.activeSkillIds).toEqual([
      "guardian.fortify",
      "guardian.shield_bash",
    ]);
    expect(fallbackPlayer?.automation).toEqual({
      growth: "adaptive",
      progress: "balanced",
      retreat: "standard",
      rescue: "standard",
    });
    expect(thirdWelcome.accountProgress).toEqual({
      accountLevel: 1,
      experience: 0,
      nextLevelExperience: 100,
      gameCurrency: 0,
      unlockedContentIds: ["achievement.workbench-victory"],
    });
    thirdSocket.close(1000, "profile fallback verified");
  });

  it("accepts a profile-backed player while a match is running", async () => {
    const player = "midjoin-player";
    const roomId = "integration-room-midjoin";
    await upsertPlayer(env.DB, {
      id: player,
      discordUserId: null,
      displayName: "Midjoin Player",
      initialClassId: "mage",
      now: "2026-07-25T00:00:00.000Z",
    });
    await savePlayerPreferences(
      env.DB,
      player,
      {
        classId: "mage",
        loadout: {
          activeSkillIds: ["mage.arc_burst", "mage.chain_lightning"],
          weaponId: "weapon.arcane-focus",
          armorId: "armor.ranger-cloak",
          accessoryId: "accessory.arcane-signet",
        },
        automation: {
          growth: "skill",
          progress: "reward",
          retreat: "last_stand",
          rescue: "priority",
        },
        unlockedContentIds: [],
      },
      "2026-07-25T00:00:01.000Z",
    );

    const stub = roomStub(roomId);
    const hostSocket = requireWebSocket(
      await connect(stub, roomId, await createRoomTicket(roomId, "midjoin-host", "Host")),
    );
    hostSocket.accept();
    const hostWelcomePromise = nextMessage(hostSocket, (message) => message.type === "welcome");
    hostSocket.send(JSON.stringify(helloMessage("midjoin-host-hello", null)));
    await hostWelcomePromise;
    await sendAndWaitForAck(hostSocket, {
      protocolVersion: PROTOCOL_VERSION,
      type: "set_ready",
      actionId: "midjoin-host-ready",
      ready: true,
    });
    await sendAndWaitForAck(hostSocket, {
      protocolVersion: PROTOCOL_VERSION,
      type: "start_match",
      actionId: "midjoin-host-start",
    });

    const playerSocket = requireWebSocket(
      await connect(stub, roomId, await createRoomTicket(roomId, player, "Midjoin Player")),
    );
    playerSocket.accept();
    const playerWelcomePromise = nextMessage(playerSocket, (message) => message.type === "welcome");
    playerSocket.send(JSON.stringify(helloMessage("midjoin-player-hello", null)));
    const playerWelcome = await playerWelcomePromise;
    expect(playerWelcome.type).toBe("welcome");
    if (playerWelcome.type !== "welcome") {
      throw new Error("Expected mid-match welcome");
    }
    expect(playerWelcome.snapshot.status).toBe("running");
    expect(playerWelcome.snapshot.players[player]?.classId).toBe("mage");
    expect(playerWelcome.snapshot.players[player]?.loadout).toEqual({
      activeSkillIds: ["mage.arc_burst", "mage.chain_lightning"],
      weaponId: "weapon.arcane-focus",
      armorId: "armor.ranger-cloak",
      accessoryId: "accessory.arcane-signet",
    });
    expect(playerWelcome.snapshot.players[player]?.automation).toEqual({
      growth: "skill",
      progress: "reward",
      retreat: "last_stand",
      rescue: "priority",
    });

    hostSocket.close(1000, "mid-match host complete");
    playerSocket.close(1000, "mid-match profile complete");
  });

  it("uses a Durable Object alarm for a pending decision after hibernation", async () => {
    const roomId = "integration-room-decision-alarm";
    const stub = roomStub(roomId);
    const ticket = await createRoomTicket(roomId, "player-one", "Player One");
    const response = await connect(stub, roomId, ticket);
    const socket = requireWebSocket(response);
    socket.accept();

    const welcomePromise = nextMessage(socket, (message) => message.type === "welcome");
    socket.send(JSON.stringify(helloMessage("decision-hello", null)));
    await welcomePromise;

    socket.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: "set_ready",
        actionId: "decision-ready",
        ready: true,
      }),
    );
    await nextMessage(
      socket,
      (message) => message.type === "command_ack" && message.actionId === "decision-ready",
    );

    const openedPromise = nextMessage(
      socket,
      (message) =>
        message.type === "events" &&
        message.events.some((event) => event.type === "decision_opened"),
    );
    socket.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: "start_match",
        actionId: "decision-start",
      }),
    );
    const opened = await openedPromise;
    expect(opened.type).toBe("events");

    await evictDurableObject(stub, { webSockets: "hibernate" });

    const resolvedPromise = nextMessage(
      socket,
      (message) =>
        message.type === "events" &&
        message.events.some((event) => event.type === "decision_resolved"),
    );
    const snapshotPromise = nextMessage(
      socket,
      (message) => message.type === "snapshot" && message.snapshot.activeDecision === null,
    );
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const resolved = await resolvedPromise;
    const snapshot = await snapshotPromise;
    expect(resolved.type).toBe("events");
    expect(snapshot.type).toBe("snapshot");

    socket.close(1000, "test complete");
  }, 15_000);

  it("restores a rescue action and advances it through a Durable Object alarm", async () => {
    const roomId = "integration-room-rescue-alarm";
    const stub = roomStub(roomId);
    const game = createRescueGame();
    const target = game.players["player-2"];
    const rescuer = game.players["player-1"];
    if (target === undefined || rescuer === undefined) {
      throw new Error("Expected rescue party");
    }
    target.hp = 0;
    target.downed = true;
    target.downedAtMs = game.elapsedMs;
    target.rescueDeadlineMs = game.elapsedMs + 10_000;
    rescuer.rescueTargetId = target.id;
    rescuer.rescueProgressMs = 0;
    for (const enemy of Object.values(game.enemies)) {
      enemy.hp = enemy.maxHp;
    }

    await runInDurableObject(stub, async (_instance: GameRoom, state) => {
      await state.storage.put("room-snapshot", {
        storageSchemaVersion: 2,
        savedAt: "2026-07-25T00:00:00.000Z",
        stateRevision: 1,
        roomId,
        matchStartedAt: "2026-07-25T00:00:00.000Z",
        game: toStoredGameState(game),
      });
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    await evictDurableObject(stub, { webSockets: "close" });

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const stored = await runInDurableObject(stub, async (_instance: GameRoom, state) =>
      state.storage.get<{ readonly game: StoredGameState }>("room-snapshot"),
    );
    expect(stored?.game.players["player-2"]?.downed).toBe(false);
    expect(stored?.game.players["player-2"]?.hp).toBeGreaterThan(0);
    expect(stored?.game.players["player-1"]?.rescueCooldownMs).toBeGreaterThan(0);
  }, 15_000);

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
        result: {
          outcome: "victory",
          durationMs: 60_000,
          completedAtTick: 600,
          unlocks: {},
        },
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

function createRescueGame(): GameState {
  let game = createGame({
    matchId: matchId("rescue-alarm-match"),
    seed: "rescue-alarm-seed",
    content: CURRENT_CONTENT,
  });
  for (const [index, id] of ["player-1", "player-2"].entries()) {
    game = applyCommand(
      game,
      {
        type: "join_player",
        actionId: actionId(`rescue-join-${index}`),
        playerId: playerId(id),
        displayName: `Player ${index + 1}`,
        classId: index === 0 ? "guardian" : "support",
      },
      CURRENT_CONTENT,
    ).state;
  }
  for (const [index, id] of ["player-1", "player-2"].entries()) {
    game = applyCommand(
      game,
      {
        type: "set_ready",
        actionId: actionId(`rescue-ready-${index}`),
        playerId: playerId(id),
        ready: true,
      },
      CURRENT_CONTENT,
    ).state;
  }
  game = applyCommand(
    game,
    {
      type: "start_match",
      actionId: actionId("rescue-start"),
      playerId: playerId("player-1"),
    },
    CURRENT_CONTENT,
  ).state;
  game.activeDecision = null;
  game.decisionIndex = CURRENT_CONTENT.stage.decisions?.length ?? 0;
  return game;
}

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

async function sendAndWaitForAck(
  socket: WebSocket,
  message: Readonly<Record<string, unknown>> & { readonly actionId: string },
): Promise<void> {
  const action = message;
  const ackPromise = nextMessage(
    socket,
    (serverMessage) =>
      serverMessage.type === "command_ack" && serverMessage.actionId === action.actionId,
  );
  socket.send(JSON.stringify(message));
  const ack = await ackPromise;
  expect(ack.type).toBe("command_ack");
}

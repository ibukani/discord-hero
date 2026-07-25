import { describe, expect, it } from "vitest";
import {
  ClientMessageSchema,
  DiscordTokenExchangeRequestSchema,
  LocalAuthRequestSchema,
  PROTOCOL_VERSION,
  RoomIdSchema,
  ServerMessageSchema,
  parsePersistedRoomSnapshot,
} from "../src/index.js";

describe("protocol schemas", () => {
  it("accepts a valid skill command", () => {
    const parsed = ClientMessageSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      type: "cast_skill",
      actionId: "action-1",
      skillId: "mage.arc_burst",
    });

    expect(parsed.type).toBe("cast_skill");
  });

  it("requires content compatibility information in hello", () => {
    const valid = ClientMessageSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      type: "hello",
      actionId: "hello-1",
      classId: "guardian",
      rulesetVersion: "1.0.0",
      contentVersion: "2026.07.1",
      lastStateRevision: null,
    });
    const missingVersions = ClientMessageSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      type: "hello",
      actionId: "hello-2",
      classId: "guardian",
      lastStateRevision: null,
    });

    expect(valid.success).toBe(true);
    expect(missingVersions.success).toBe(false);
  });

  it("validates command acknowledgements", () => {
    expect(
      ServerMessageSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        type: "command_ack",
        actionId: "action-1",
        stateRevision: 4,
        serverTick: 20,
      }).type,
    ).toBe("command_ack");
  });

  it("rejects unsupported protocol versions", () => {
    const result = ClientMessageSchema.safeParse({
      protocolVersion: 999,
      type: "start_match",
      actionId: "action-1",
    });

    expect(result.success).toBe(false);
  });

  it("rejects path-like room identifiers", () => {
    expect(RoomIdSchema.safeParse("../production").success).toBe(false);
  });

  it("requires a room scope when creating either session type", () => {
    expect(DiscordTokenExchangeRequestSchema.safeParse({ code: "oauth-code" }).success).toBe(false);
    expect(
      DiscordTokenExchangeRequestSchema.safeParse({ code: "oauth-code", roomId: "room-1" }).success,
    ).toBe(true);
    expect(
      LocalAuthRequestSchema.safeParse({ userId: "player-1", displayName: "Player" }).success,
    ).toBe(false);
  });
});

describe("persisted room snapshot migrations", () => {
  it("migrates storage version 1 to the current representation", () => {
    const result = parsePersistedRoomSnapshot(createVersionOneSnapshot());

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected snapshot migration to succeed");
    }
    expect(result.migratedFromVersion).toBe(1);
    expect(result.data.storageSchemaVersion).toBe(2);
    expect(result.data.stateRevision).toBe(7);
    expect(result.data.roomId).toBeNull();
  });

  it("rejects unknown storage versions without reinterpreting them", () => {
    const result = parsePersistedRoomSnapshot({
      ...createVersionOneSnapshot(),
      storageSchemaVersion: 99,
    });

    expect(result).toEqual({ success: false, reason: "unsupported_storage_version" });
  });
});

function createVersionOneSnapshot(): Record<string, unknown> {
  return {
    storageSchemaVersion: 1,
    savedAt: "2026-07-25T00:00:00.000Z",
    serverSequence: 7,
    matchStartedAt: null,
    game: {
      schemaVersion: 1,
      matchId: "match-1",
      seed: "seed-1",
      rulesetVersion: "1.0.0",
      contentVersion: "2026.07.1",
      status: "lobby",
      tick: 0,
      elapsedMs: 0,
      randomState: 1,
      waveIndex: 0,
      spawnSequence: 0,
      players: {},
      enemies: {},
      processedActionIds: [],
      result: null,
    },
  };
}

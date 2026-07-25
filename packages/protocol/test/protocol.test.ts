import { describe, expect, it } from "vitest";
import {
  ClientMessageSchema,
  DiscordTokenExchangeRequestSchema,
  LocalAuthRequestSchema,
  PROTOCOL_VERSION,
  RoomIdSchema,
  ServerMessageSchema,
  GameSnapshotSchema,
  MatchResultSchema,
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

  it("accepts validated automation policy commands", () => {
    const parsed = ClientMessageSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      type: "set_automation_policy",
      actionId: "policy-1",
      policy: { growth: "survival", progress: "safe", retreat: "early" },
    });

    expect(parsed.type).toBe("set_automation_policy");
  });

  it("accepts loadout changes and decision overrides", () => {
    expect(
      ClientMessageSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        type: "set_loadout",
        actionId: "loadout-1",
        activeSkillIds: ["mage.arc_burst", "mage.chain_lightning"],
      }).type,
    ).toBe("set_loadout");
    expect(
      ClientMessageSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        type: "override_decision",
        actionId: "override-1",
        decisionId: "outskirts-crossroads",
        choiceId: "safe-trail",
      }).type,
    ).toBe("override_decision");
    expect(
      ClientMessageSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        type: "rescue_player",
        actionId: "rescue-1",
        targetPlayerId: "player-2",
      }).type,
    ).toBe("rescue_player");
    expect(
      ClientMessageSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        type: "set_equipment",
        actionId: "equipment-1",
        weaponId: "weapon.iron-sword",
        armorId: "armor.guardian-plate",
        accessoryId: null,
      }).type,
    ).toBe("set_equipment");
  });

  it("rejects unknown automation policy values", () => {
    const parsed = ClientMessageSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      type: "set_automation_policy",
      actionId: "policy-2",
      policy: { growth: "preset", progress: "safe", retreat: "early" },
    });

    expect(parsed.success).toBe(false);
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

  it("accepts automatic decision and return events", () => {
    const parsed = ServerMessageSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      type: "events",
      stateRevision: 8,
      serverTick: 24,
      events: [
        {
          type: "decision_opened",
          decision: {
            kind: "route",
            decisionId: "outskirts-crossroads",
            choices: [
              { id: "safe-trail", kind: "safe", risk: 12, reward: 20, healPercent: 4 },
              { id: "hazard-yard", kind: "risky", risk: 38, reward: 70, damagePercent: 4 },
            ],
            openedAtMs: 1_000,
            deadlineMs: 5_000,
            votes: { "player-1": "hazard-yard" },
            overriddenPlayerIds: [],
          },
        },
        {
          type: "decision_overridden",
          playerId: "player-1",
          decisionId: "outskirts-crossroads",
          choiceId: "safe-trail",
        },
        {
          type: "decision_resolved",
          decision: {
            kind: "route",
            decisionId: "outskirts-crossroads",
            choiceId: "safe-trail",
            risk: 12,
            reward: 20,
            voterCount: 1,
            totalVoters: 1,
            policy: "balanced",
          },
        },
        {
          type: "retreat_decided",
          policy: "standard",
          reason: "health_threshold",
          averageHpPercent: 20,
        },
        { type: "player_downed", playerId: "player-2", rescueDeadlineMs: 12_000 },
        { type: "rescue_started", rescuerId: "player-1", targetId: "player-2" },
        { type: "player_rescued", rescuerId: "player-1", targetId: "player-2", hp: 35 },
        { type: "player_eliminated", playerId: "player-3" },
        {
          type: "equipment_changed",
          playerId: "player-1",
          weaponId: "weapon.iron-sword",
          armorId: "armor.guardian-plate",
          accessoryId: null,
          synergyIds: [],
        },
        {
          type: "match_ended",
          result: { outcome: "return", durationMs: 1_000, completedAtTick: 10 },
        },
      ],
    });

    expect(parsed.type).toBe("events");
  });

  it("defaults rewards when reading a result created before reward settlement", () => {
    expect(
      MatchResultSchema.parse({
        outcome: "return",
        durationMs: 1_000,
        completedAtTick: 10,
      }).rewards,
    ).toEqual({});
  });

  it("preserves an active decision in a client snapshot", () => {
    const snapshot = GameSnapshotSchema.parse({
      schemaVersion: 1,
      matchId: "match-1",
      seed: "seed-1",
      rulesetVersion: "1.0.0",
      contentVersion: "2026.07.1",
      status: "running",
      tick: 10,
      elapsedMs: 1_000,
      waveIndex: 0,
      players: {},
      enemies: {},
      result: null,
      activeDecision: {
        kind: "event",
        decisionId: "old-workbench",
        choices: [{ id: "field-repair", kind: "rest", risk: 5, reward: 25, healPercent: 18 }],
        openedAtMs: 1_000,
        deadlineMs: 5_000,
        votes: {},
        overriddenPlayerIds: [],
      },
    });

    expect(snapshot.activeDecision?.decisionId).toBe("old-workbench");
  });

  it("migrates old player snapshots with a safe rescue state", () => {
    const snapshot = GameSnapshotSchema.parse({
      schemaVersion: 1,
      matchId: "match-1",
      seed: "seed-1",
      rulesetVersion: "1.0.0",
      contentVersion: "2026.07.1",
      status: "lobby",
      tick: 0,
      elapsedMs: 0,
      waveIndex: 0,
      players: {
        "player-1": {
          id: "player-1",
          displayName: "Player",
          classId: "guardian",
          ready: false,
          connection: "connected",
          hp: 100,
          maxHp: 100,
          shield: 0,
          level: 1,
          experience: 0,
          nextLevelExperience: 30,
          attackPower: 10,
          skillCooldowns: {},
          upgrades: [],
          pendingUpgradeChoices: [],
          score: 0,
          stats: { damageDealt: 0, healingDone: 0, damageTaken: 0, enemiesDefeated: 0 },
        },
      },
      enemies: {},
      result: null,
    });

    expect(snapshot.players["player-1"]?.downed).toBe(false);
    expect(snapshot.players["player-1"]?.rescueDeadlineMs).toBeNull();
    expect(snapshot.players["player-1"]?.automation.rescue).toBe("standard");
    expect(snapshot.players["player-1"]?.loadout.weaponId).toBeNull();
    expect(snapshot.players["player-1"]?.activeSynergyIds).toEqual([]);
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

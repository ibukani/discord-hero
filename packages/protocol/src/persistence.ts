import { z } from "zod";
import { HeroClassIdSchema, SafeIdSchema } from "./common.js";
import {
  AutomationPolicySchema,
  ActiveDecisionSchema,
  DEFAULT_AUTOMATION_POLICY_DTO,
  DecisionSummarySchema,
  MatchResultSchema,
  PlayerStatsSchema,
  LoadoutSchema,
} from "./game-state.js";

const StoredPlayerStateSchema = z.object({
  id: SafeIdSchema,
  displayName: z.string().min(1).max(48),
  classId: HeroClassIdSchema,
  ready: z.boolean(),
  connection: z.enum(["connected", "ai_controlled"]),
  hp: z.number().int().nonnegative(),
  maxHp: z.number().int().positive(),
  shield: z.number().int().nonnegative(),
  downed: z.boolean().default(false),
  eliminated: z.boolean().default(false),
  downedAtMs: z.number().int().nonnegative().nullable().default(null),
  rescueDeadlineMs: z.number().int().nonnegative().nullable().default(null),
  rescueTargetId: SafeIdSchema.nullable().default(null),
  rescueProgressMs: z.number().int().nonnegative().default(0),
  rescueCooldownMs: z.number().int().nonnegative().default(0),
  rescueDurationMultiplier: z.number().positive().default(1),
  waveShieldBonus: z.number().int().nonnegative().default(0),
  activeSynergyIds: z.array(SafeIdSchema).max(16).default([]),
  unlockedContentIds: z.array(SafeIdSchema).max(128).default([]),
  level: z.number().int().positive(),
  experience: z.number().int().nonnegative(),
  nextLevelExperience: z.number().int().positive(),
  attackPower: z.number().int().positive(),
  attackIntervalMs: z.number().int().positive(),
  attackCooldownMs: z.number().int().nonnegative(),
  loadout: LoadoutSchema.default({
    activeSkillIds: [],
    weaponId: null,
    armorId: null,
    accessoryId: null,
  }),
  automation: AutomationPolicySchema.default(DEFAULT_AUTOMATION_POLICY_DTO),
  skillCooldownMultiplier: z.number().positive(),
  healingMultiplier: z.number().positive(),
  skillCooldowns: z.record(z.string(), z.number().int().nonnegative()),
  upgrades: z.array(z.string().min(1).max(96)),
  pendingUpgradeChoices: z.array(z.string().min(1).max(96)).max(3),
  score: z.number().int().nonnegative(),
  stats: PlayerStatsSchema,
});

const StoredEnemyStateSchema = z.object({
  id: SafeIdSchema,
  definitionId: z.string().min(1).max(96),
  hp: z.number().int().nonnegative(),
  maxHp: z.number().int().positive(),
  attackPower: z.number().int().nonnegative(),
  attackIntervalMs: z.number().int().positive(),
  attackCooldownMs: z.number().int().nonnegative(),
  boss: z.boolean(),
});

export const StoredGameStateSchema = z.object({
  schemaVersion: z.literal(1),
  matchId: SafeIdSchema,
  seed: z.string().min(1).max(128),
  rulesetVersion: z.string().min(1).max(32),
  contentVersion: z.string().min(1).max(32),
  status: z.enum(["lobby", "running", "victory", "defeat", "return"]),
  tick: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  randomState: z.number().int().nonnegative(),
  waveIndex: z.number().int().nonnegative(),
  decisionIndex: z.number().int().nonnegative().default(0),
  activeDecision: ActiveDecisionSchema.nullable().default(null),
  lastDecision: DecisionSummarySchema.nullable().default(null),
  spawnSequence: z.number().int().nonnegative(),
  players: z.record(SafeIdSchema, StoredPlayerStateSchema),
  enemies: z.record(SafeIdSchema, StoredEnemyStateSchema),
  processedActionIds: z.array(SafeIdSchema).max(512),
  result: MatchResultSchema.nullable(),
});

export const PersistedRoomSnapshotV1Schema = z.object({
  storageSchemaVersion: z.literal(1),
  savedAt: z.iso.datetime(),
  serverSequence: z.number().int().nonnegative(),
  matchStartedAt: z.iso.datetime().nullable(),
  game: StoredGameStateSchema,
});

export const PersistedRoomSnapshotSchema = z.object({
  storageSchemaVersion: z.literal(2),
  savedAt: z.iso.datetime(),
  stateRevision: z.number().int().nonnegative(),
  roomId: z.string().min(1).max(96).nullable(),
  matchStartedAt: z.iso.datetime().nullable(),
  game: StoredGameStateSchema,
});

export const MatchFinishedEventSchema = z.object({
  eventId: SafeIdSchema,
  matchId: SafeIdSchema,
  rulesetVersion: z.string().min(1).max(32),
  contentVersion: z.string().min(1).max(32),
  seed: z.string().min(1).max(128),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  result: MatchResultSchema,
  players: z.array(
    z.object({
      playerId: SafeIdSchema,
      displayName: z.string().min(1).max(48),
      classId: HeroClassIdSchema,
      score: z.number().int().nonnegative(),
      stats: PlayerStatsSchema,
    }),
  ),
});

export type StoredGameState = z.infer<typeof StoredGameStateSchema>;
export type PersistedRoomSnapshot = z.infer<typeof PersistedRoomSnapshotSchema>;
export type MatchFinishedEvent = z.infer<typeof MatchFinishedEventSchema>;

export type PersistedRoomSnapshotParseResult =
  | {
      readonly success: true;
      readonly data: PersistedRoomSnapshot;
      readonly migratedFromVersion: 1 | null;
    }
  | {
      readonly success: false;
      readonly reason: "invalid_snapshot" | "unsupported_storage_version";
    };

const StorageVersionProbeSchema = z.object({
  storageSchemaVersion: z.number().int(),
});

export function parsePersistedRoomSnapshot(input: unknown): PersistedRoomSnapshotParseResult {
  const versionProbe = StorageVersionProbeSchema.safeParse(input);
  if (!versionProbe.success) {
    return { success: false, reason: "invalid_snapshot" };
  }

  if (versionProbe.data.storageSchemaVersion === 2) {
    const parsed = PersistedRoomSnapshotSchema.safeParse(input);
    return parsed.success
      ? { success: true, data: parsed.data, migratedFromVersion: null }
      : { success: false, reason: "invalid_snapshot" };
  }

  if (versionProbe.data.storageSchemaVersion === 1) {
    const parsed = PersistedRoomSnapshotV1Schema.safeParse(input);
    if (!parsed.success) {
      return { success: false, reason: "invalid_snapshot" };
    }
    return {
      success: true,
      migratedFromVersion: 1,
      data: {
        storageSchemaVersion: 2,
        savedAt: parsed.data.savedAt,
        stateRevision: parsed.data.serverSequence,
        roomId: null,
        matchStartedAt: parsed.data.matchStartedAt,
        game: parsed.data.game,
      },
    };
  }

  return { success: false, reason: "unsupported_storage_version" };
}

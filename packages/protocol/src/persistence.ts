import { z } from "zod";
import { HeroClassIdSchema, SafeIdSchema } from "./common.js";
import { MatchResultSchema, PlayerStatsSchema } from "./game-state.js";

const StoredPlayerStateSchema = z.object({
  id: SafeIdSchema,
  displayName: z.string().min(1).max(48),
  classId: HeroClassIdSchema,
  ready: z.boolean(),
  connection: z.enum(["connected", "ai_controlled"]),
  hp: z.number().int().nonnegative(),
  maxHp: z.number().int().positive(),
  shield: z.number().int().nonnegative(),
  level: z.number().int().positive(),
  experience: z.number().int().nonnegative(),
  nextLevelExperience: z.number().int().positive(),
  attackPower: z.number().int().positive(),
  attackIntervalMs: z.number().int().positive(),
  attackCooldownMs: z.number().int().nonnegative(),
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
  status: z.enum(["lobby", "running", "victory", "defeat"]),
  tick: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  randomState: z.number().int().nonnegative(),
  waveIndex: z.number().int().nonnegative(),
  spawnSequence: z.number().int().nonnegative(),
  players: z.record(SafeIdSchema, StoredPlayerStateSchema),
  enemies: z.record(SafeIdSchema, StoredEnemyStateSchema),
  processedActionIds: z.array(SafeIdSchema).max(512),
  result: MatchResultSchema.nullable(),
});

export const PersistedRoomSnapshotSchema = z.object({
  storageSchemaVersion: z.literal(1),
  savedAt: z.iso.datetime(),
  serverSequence: z.number().int().nonnegative(),
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

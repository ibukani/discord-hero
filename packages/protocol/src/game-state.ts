import { z } from "zod";
import { DisplayNameSchema, HeroClassIdSchema, SafeIdSchema } from "./common.js";

export const PlayerStatsSchema = z.object({
  damageDealt: z.number().int().nonnegative(),
  healingDone: z.number().int().nonnegative(),
  damageTaken: z.number().int().nonnegative(),
  enemiesDefeated: z.number().int().nonnegative(),
});

export const PlayerSnapshotSchema = z.object({
  id: SafeIdSchema,
  displayName: DisplayNameSchema,
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
  skillCooldowns: z.record(z.string(), z.number().int().nonnegative()),
  upgrades: z.array(z.string().min(1).max(96)),
  pendingUpgradeChoices: z.array(z.string().min(1).max(96)).max(3),
  score: z.number().int().nonnegative(),
  stats: PlayerStatsSchema,
});

export const EnemySnapshotSchema = z.object({
  id: SafeIdSchema,
  definitionId: z.string().min(1).max(96),
  hp: z.number().int().nonnegative(),
  maxHp: z.number().int().positive(),
  attackCooldownMs: z.number().int().nonnegative(),
  boss: z.boolean(),
});

export const MatchResultSchema = z.object({
  outcome: z.enum(["victory", "defeat"]),
  durationMs: z.number().int().nonnegative(),
  completedAtTick: z.number().int().nonnegative(),
});

export const GameSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  matchId: SafeIdSchema,
  seed: z.string().min(1).max(128),
  rulesetVersion: z.string().min(1).max(32),
  contentVersion: z.string().min(1).max(32),
  status: z.enum(["lobby", "running", "victory", "defeat"]),
  tick: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  waveIndex: z.number().int().nonnegative(),
  players: z.record(SafeIdSchema, PlayerSnapshotSchema),
  enemies: z.record(SafeIdSchema, EnemySnapshotSchema),
  result: MatchResultSchema.nullable(),
});

export type PlayerSnapshot = z.infer<typeof PlayerSnapshotSchema>;
export type EnemySnapshot = z.infer<typeof EnemySnapshotSchema>;
export type MatchResultDto = z.infer<typeof MatchResultSchema>;
export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;

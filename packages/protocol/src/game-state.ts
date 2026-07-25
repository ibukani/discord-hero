import { z } from "zod";
import { DisplayNameSchema, HeroClassIdSchema, SafeIdSchema } from "./common.js";

export const GrowthPolicySchema = z.enum(["adaptive", "offense", "survival", "skill", "support"]);
export const ProgressPolicySchema = z.enum(["safe", "balanced", "reward", "exploration"]);
export const RetreatPolicySchema = z.enum(["early", "standard", "last_stand"]);
export const RescuePolicySchema = z.enum(["off", "standard", "priority"]);
export const ExpeditionDecisionKindSchema = z.enum(["route", "event"]);
export const ExpeditionChoiceKindSchema = z.enum(["safe", "risky", "rest", "mystery"]);
export const AutomationPolicySchema = z.object({
  growth: GrowthPolicySchema,
  progress: ProgressPolicySchema,
  retreat: RetreatPolicySchema,
  rescue: RescuePolicySchema.default("standard"),
});
export const DEFAULT_AUTOMATION_POLICY_DTO = {
  growth: "adaptive",
  progress: "balanced",
  retreat: "standard",
  rescue: "standard",
} as const;
export type GrowthPolicyDto = z.infer<typeof GrowthPolicySchema>;
export type ProgressPolicyDto = z.infer<typeof ProgressPolicySchema>;
export type RetreatPolicyDto = z.infer<typeof RetreatPolicySchema>;
export type RescuePolicyDto = z.infer<typeof RescuePolicySchema>;
export type AutomationPolicyDto = z.infer<typeof AutomationPolicySchema>;

export const PlayerStatsSchema = z.object({
  damageDealt: z.number().int().nonnegative(),
  healingDone: z.number().int().nonnegative(),
  damageTaken: z.number().int().nonnegative(),
  enemiesDefeated: z.number().int().nonnegative(),
});

export const AccountProgressSchema = z.object({
  accountLevel: z.number().int().positive(),
  experience: z.number().int().nonnegative(),
  nextLevelExperience: z.number().int().positive(),
  gameCurrency: z.number().int().nonnegative(),
  unlockedContentIds: z.array(SafeIdSchema).max(128),
});

export const DEFAULT_ACCOUNT_PROGRESS = {
  accountLevel: 1,
  experience: 0,
  nextLevelExperience: 100,
  gameCurrency: 0,
  unlockedContentIds: [],
};

export const DecisionSummarySchema = z.object({
  kind: ExpeditionDecisionKindSchema,
  decisionId: SafeIdSchema,
  choiceId: SafeIdSchema,
  risk: z.number().int().nonnegative().max(100),
  reward: z.number().int().nonnegative(),
  voterCount: z.number().int().nonnegative(),
  totalVoters: z.number().int().nonnegative(),
  policy: ProgressPolicySchema,
});

export const LoadoutSchema = z.object({
  activeSkillIds: z.array(z.string().min(1).max(96)).max(2),
  weaponId: SafeIdSchema.nullable().default(null),
  armorId: SafeIdSchema.nullable().default(null),
  accessoryId: SafeIdSchema.nullable().default(null),
});

export const DecisionChoicePreviewSchema = z.object({
  id: SafeIdSchema,
  kind: ExpeditionChoiceKindSchema,
  risk: z.number().int().nonnegative().max(100),
  reward: z.number().int().nonnegative(),
  healPercent: z.number().int().nonnegative().max(100).optional(),
  damagePercent: z.number().int().nonnegative().max(100).optional(),
});

export const ActiveDecisionSchema = z.object({
  kind: ExpeditionDecisionKindSchema,
  decisionId: SafeIdSchema,
  choices: z.array(DecisionChoicePreviewSchema).min(1).max(8),
  openedAtMs: z.number().int().nonnegative(),
  deadlineMs: z.number().int().nonnegative(),
  votes: z.record(SafeIdSchema, SafeIdSchema),
  overriddenPlayerIds: z.array(SafeIdSchema).max(8),
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
  level: z.number().int().positive(),
  experience: z.number().int().nonnegative(),
  nextLevelExperience: z.number().int().positive(),
  attackPower: z.number().int().positive(),
  loadout: LoadoutSchema.default({
    activeSkillIds: [],
    weaponId: null,
    armorId: null,
    accessoryId: null,
  }),
  automation: AutomationPolicySchema.default(DEFAULT_AUTOMATION_POLICY_DTO),
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

export const MatchRewardSchema = z.object({
  currency: z.number().int().nonnegative(),
  experience: z.number().int().nonnegative(),
});

export const MatchUnlocksSchema = z.record(SafeIdSchema, z.array(SafeIdSchema).max(32)).default({});

export const MatchResultSchema = z.object({
  outcome: z.enum(["victory", "defeat", "return"]),
  durationMs: z.number().int().nonnegative(),
  completedAtTick: z.number().int().nonnegative(),
  rewards: z.record(SafeIdSchema, MatchRewardSchema).default({}),
  unlocks: MatchUnlocksSchema,
});

export const GameSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  matchId: SafeIdSchema,
  seed: z.string().min(1).max(128),
  rulesetVersion: z.string().min(1).max(32),
  contentVersion: z.string().min(1).max(32),
  status: z.enum(["lobby", "running", "victory", "defeat", "return"]),
  tick: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  waveIndex: z.number().int().nonnegative(),
  decisionIndex: z.number().int().nonnegative().default(0),
  activeDecision: ActiveDecisionSchema.nullable().default(null),
  lastDecision: DecisionSummarySchema.nullable().default(null),
  players: z.record(SafeIdSchema, PlayerSnapshotSchema),
  enemies: z.record(SafeIdSchema, EnemySnapshotSchema),
  result: MatchResultSchema.nullable(),
});

export type PlayerSnapshot = z.infer<typeof PlayerSnapshotSchema>;
export type EnemySnapshot = z.infer<typeof EnemySnapshotSchema>;
export type AccountProgress = z.infer<typeof AccountProgressSchema>;
export type LoadoutDto = z.infer<typeof LoadoutSchema>;
export type MatchResultDto = z.infer<typeof MatchResultSchema>;
export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;

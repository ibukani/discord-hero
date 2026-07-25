export const HERO_CLASS_IDS = ["guardian", "ranger", "mage", "support"] as const;
export type HeroClassId = (typeof HERO_CLASS_IDS)[number];

export type EquipmentSlot = "weapon" | "armor" | "accessory";

export type EquipmentEffect =
  | { readonly type: "attack_power_bonus"; readonly amount: number }
  | { readonly type: "max_hp_bonus"; readonly amount: number }
  | { readonly type: "attack_interval_multiplier"; readonly multiplier: number }
  | { readonly type: "skill_cooldown_multiplier"; readonly multiplier: number }
  | { readonly type: "healing_multiplier"; readonly multiplier: number }
  | { readonly type: "rescue_duration_multiplier"; readonly multiplier: number }
  | { readonly type: "shield_on_wave"; readonly amount: number };

export interface EquipmentDefinition {
  readonly id: string;
  readonly slot: EquipmentSlot;
  readonly allowedClassIds: readonly HeroClassId[];
  readonly tags: readonly string[];
  readonly effects: readonly EquipmentEffect[];
}

export interface EquipmentSynergyDefinition {
  readonly id: string;
  readonly requiredEquipmentTags: readonly string[];
  readonly requiredSkillIds: readonly string[];
  readonly effects: readonly EquipmentEffect[];
}

export type SkillEffect =
  | { readonly type: "damage_single"; readonly power: number }
  | { readonly type: "damage_all"; readonly power: number }
  | { readonly type: "heal_all"; readonly power: number }
  | { readonly type: "shield_all"; readonly power: number };

export interface SkillDefinition {
  readonly id: string;
  readonly classId: HeroClassId;
  readonly cooldownMs: number;
  readonly effect: SkillEffect;
}

export interface HeroClassDefinition {
  readonly id: HeroClassId;
  readonly maxHp: number;
  readonly attackPower: number;
  readonly attackIntervalMs: number;
  readonly skillIds: readonly string[];
  readonly equipmentIds: readonly string[];
}

export interface EnemyDefinition {
  readonly id: string;
  readonly maxHp: number;
  readonly attackPower: number;
  readonly attackIntervalMs: number;
  readonly experience: number;
  readonly score: number;
  readonly boss: boolean;
}

export interface WaveDefinition {
  readonly enemyDefinitionIds: readonly string[];
}

export type ExpeditionDecisionKind = "route" | "event";
export type ExpeditionChoiceKind = "safe" | "risky" | "rest" | "mystery";

export interface ExpeditionChoiceDefinition {
  readonly id: string;
  readonly kind: ExpeditionChoiceKind;
  readonly risk: number;
  readonly reward: number;
  readonly healPercent?: number;
  readonly damagePercent?: number;
}

export interface ExpeditionDecisionDefinition {
  readonly id: string;
  readonly kind: ExpeditionDecisionKind;
  readonly choices: readonly ExpeditionChoiceDefinition[];
}

export interface StageDefinition {
  readonly id: string;
  readonly waves: readonly WaveDefinition[];
  readonly decisions?: readonly ExpeditionDecisionDefinition[];
}

export interface UpgradeDefinition {
  readonly id: string;
  readonly attackMultiplier?: number;
  readonly maxHpBonus?: number;
  readonly skillCooldownMultiplier?: number;
  readonly healingMultiplier?: number;
}

export type RewardOutcome = "victory" | "return" | "defeat";

export interface RewardPolicy {
  readonly currencyBaseByOutcome: Readonly<Record<RewardOutcome, number>>;
  readonly experienceBaseByOutcome: Readonly<Record<RewardOutcome, number>>;
  readonly currencyPerWave: number;
  readonly currencyPerScore: number;
  readonly experiencePerWave: number;
  readonly experiencePerEnemyDefeated: number;
}

export interface GameContent {
  readonly version: string;
  readonly rulesetVersion: string;
  readonly classes: Readonly<Record<HeroClassId, HeroClassDefinition>>;
  readonly skills: Readonly<Record<string, SkillDefinition>>;
  readonly equipment: Readonly<Record<string, EquipmentDefinition>>;
  readonly equipmentSynergies: Readonly<Record<string, EquipmentSynergyDefinition>>;
  readonly enemies: Readonly<Record<string, EnemyDefinition>>;
  readonly upgrades: Readonly<Record<string, UpgradeDefinition>>;
  readonly rewardPolicy: RewardPolicy;
  readonly stage: StageDefinition;
}

export const HERO_CLASS_IDS = ["guardian", "ranger", "mage", "support"] as const;
export type HeroClassId = (typeof HERO_CLASS_IDS)[number];

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

export interface StageDefinition {
  readonly id: string;
  readonly waves: readonly WaveDefinition[];
}

export interface UpgradeDefinition {
  readonly id: string;
  readonly attackMultiplier?: number;
  readonly maxHpBonus?: number;
  readonly skillCooldownMultiplier?: number;
  readonly healingMultiplier?: number;
}

export interface GameContent {
  readonly version: string;
  readonly rulesetVersion: string;
  readonly classes: Readonly<Record<HeroClassId, HeroClassDefinition>>;
  readonly skills: Readonly<Record<string, SkillDefinition>>;
  readonly enemies: Readonly<Record<string, EnemyDefinition>>;
  readonly upgrades: Readonly<Record<string, UpgradeDefinition>>;
  readonly stage: StageDefinition;
}

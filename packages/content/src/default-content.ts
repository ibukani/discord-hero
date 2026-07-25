import type { GameContent } from "@discord-hero/game-core";

export const DEFAULT_CONTENT: GameContent = {
  version: "2026.07.1",
  rulesetVersion: "1.0.0",
  classes: {
    guardian: {
      id: "guardian",
      maxHp: 180,
      attackPower: 13,
      attackIntervalMs: 1_200,
      skillIds: ["guardian.fortify", "guardian.shield_bash"],
    },
    ranger: {
      id: "ranger",
      maxHp: 115,
      attackPower: 21,
      attackIntervalMs: 850,
      skillIds: ["ranger.piercing_shot", "ranger.volley"],
    },
    mage: {
      id: "mage",
      maxHp: 100,
      attackPower: 18,
      attackIntervalMs: 1_000,
      skillIds: ["mage.arc_burst", "mage.chain_lightning"],
    },
    support: {
      id: "support",
      maxHp: 125,
      attackPower: 11,
      attackIntervalMs: 1_100,
      skillIds: ["support.group_heal", "support.aegis"],
    },
  },
  skills: {
    "guardian.fortify": {
      id: "guardian.fortify",
      classId: "guardian",
      cooldownMs: 8_000,
      effect: { type: "shield_all", power: 24 },
    },
    "guardian.shield_bash": {
      id: "guardian.shield_bash",
      classId: "guardian",
      cooldownMs: 5_000,
      effect: { type: "damage_single", power: 48 },
    },
    "ranger.piercing_shot": {
      id: "ranger.piercing_shot",
      classId: "ranger",
      cooldownMs: 4_000,
      effect: { type: "damage_single", power: 70 },
    },
    "ranger.volley": {
      id: "ranger.volley",
      classId: "ranger",
      cooldownMs: 7_000,
      effect: { type: "damage_all", power: 32 },
    },
    "mage.arc_burst": {
      id: "mage.arc_burst",
      classId: "mage",
      cooldownMs: 5_500,
      effect: { type: "damage_all", power: 42 },
    },
    "mage.chain_lightning": {
      id: "mage.chain_lightning",
      classId: "mage",
      cooldownMs: 4_500,
      effect: { type: "damage_single", power: 62 },
    },
    "support.group_heal": {
      id: "support.group_heal",
      classId: "support",
      cooldownMs: 6_000,
      effect: { type: "heal_all", power: 38 },
    },
    "support.aegis": {
      id: "support.aegis",
      classId: "support",
      cooldownMs: 8_000,
      effect: { type: "shield_all", power: 18 },
    },
  },
  enemies: {
    slime: {
      id: "slime",
      maxHp: 58,
      attackPower: 8,
      attackIntervalMs: 1_500,
      experience: 12,
      score: 25,
      boss: false,
    },
    goblin: {
      id: "goblin",
      maxHp: 90,
      attackPower: 13,
      attackIntervalMs: 1_250,
      experience: 18,
      score: 40,
      boss: false,
    },
    wisp: {
      id: "wisp",
      maxHp: 70,
      attackPower: 16,
      attackIntervalMs: 1_100,
      experience: 20,
      score: 45,
      boss: false,
    },
    "clockwork-ogre": {
      id: "clockwork-ogre",
      maxHp: 850,
      attackPower: 28,
      attackIntervalMs: 1_400,
      experience: 80,
      score: 500,
      boss: true,
    },
  },
  upgrades: {
    "power.training": {
      id: "power.training",
      attackMultiplier: 1.2,
    },
    "vitality.training": {
      id: "vitality.training",
      maxHpBonus: 30,
    },
    "tempo.training": {
      id: "tempo.training",
      skillCooldownMultiplier: 0.85,
    },
    "team.restoration": {
      id: "team.restoration",
      healingMultiplier: 1.3,
    },
  },
  stage: {
    id: "workbench-outskirts",
    waves: [
      { enemyDefinitionIds: ["slime", "slime", "slime"] },
      { enemyDefinitionIds: ["goblin", "goblin", "wisp"] },
      { enemyDefinitionIds: ["goblin", "wisp", "wisp", "slime"] },
      { enemyDefinitionIds: ["clockwork-ogre"] },
    ],
  },
};

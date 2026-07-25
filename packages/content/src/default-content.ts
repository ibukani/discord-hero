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
      equipmentIds: ["weapon.iron-sword", "armor.guardian-plate", "accessory.rescue-charm"],
    },
    ranger: {
      id: "ranger",
      maxHp: 115,
      attackPower: 21,
      attackIntervalMs: 850,
      skillIds: ["ranger.piercing_shot", "ranger.volley"],
      equipmentIds: ["weapon.iron-sword", "armor.ranger-cloak", "accessory.rescue-charm"],
    },
    mage: {
      id: "mage",
      maxHp: 100,
      attackPower: 18,
      attackIntervalMs: 1_000,
      skillIds: ["mage.arc_burst", "mage.chain_lightning"],
      equipmentIds: ["weapon.arcane-focus", "armor.ranger-cloak", "accessory.arcane-signet"],
    },
    support: {
      id: "support",
      maxHp: 125,
      attackPower: 11,
      attackIntervalMs: 1_100,
      skillIds: ["support.group_heal", "support.aegis"],
      equipmentIds: ["weapon.arcane-focus", "armor.guardian-plate", "accessory.rescue-charm"],
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
  equipment: {
    "weapon.iron-sword": {
      id: "weapon.iron-sword",
      slot: "weapon",
      allowedClassIds: ["guardian", "ranger"],
      tags: ["steel", "frontline"],
      effects: [{ type: "attack_power_bonus", amount: 4 }],
    },
    "weapon.arcane-focus": {
      id: "weapon.arcane-focus",
      slot: "weapon",
      allowedClassIds: ["mage", "support"],
      tags: ["arcane", "supportive"],
      effects: [{ type: "skill_cooldown_multiplier", multiplier: 0.92 }],
    },
    "armor.guardian-plate": {
      id: "armor.guardian-plate",
      slot: "armor",
      allowedClassIds: ["guardian", "support"],
      tags: ["barrier", "frontline"],
      effects: [{ type: "max_hp_bonus", amount: 25 }],
    },
    "armor.ranger-cloak": {
      id: "armor.ranger-cloak",
      slot: "armor",
      allowedClassIds: ["ranger", "mage"],
      tags: ["swift", "evasion"],
      effects: [{ type: "attack_interval_multiplier", multiplier: 0.92 }],
    },
    "accessory.rescue-charm": {
      id: "accessory.rescue-charm",
      slot: "accessory",
      allowedClassIds: ["guardian", "ranger", "mage", "support"],
      tags: ["rescue", "supportive"],
      effects: [{ type: "rescue_duration_multiplier", multiplier: 0.85 }],
    },
    "accessory.arcane-signet": {
      id: "accessory.arcane-signet",
      slot: "accessory",
      allowedClassIds: ["mage", "support"],
      tags: ["arcane", "focus"],
      effects: [{ type: "skill_cooldown_multiplier", multiplier: 0.9 }],
    },
  },
  equipmentSynergies: {
    "barrier-vanguard": {
      id: "barrier-vanguard",
      requiredEquipmentTags: ["barrier"],
      requiredSkillIds: ["guardian.fortify"],
      effects: [{ type: "shield_on_wave", amount: 12 }],
    },
    "arcane-resonance": {
      id: "arcane-resonance",
      requiredEquipmentTags: ["arcane"],
      requiredSkillIds: ["mage.arc_burst", "mage.chain_lightning"],
      effects: [{ type: "skill_cooldown_multiplier", multiplier: 0.94 }],
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
  rewardPolicy: {
    currencyBaseByOutcome: {
      victory: 120,
      return: 60,
      defeat: 20,
    },
    experienceBaseByOutcome: {
      victory: 100,
      return: 45,
      defeat: 15,
    },
    currencyPerWave: 25,
    currencyPerScore: 0.1,
    experiencePerWave: 20,
    experiencePerEnemyDefeated: 5,
  },
  unlocks: {
    "achievement.workbench-victory": {
      id: "achievement.workbench-victory",
      unlockType: "achievement",
      contentId: "achievement.workbench-victory",
      condition: { type: "match_outcome", outcome: "victory" },
    },
    "title.workbench-survivor": {
      id: "title.workbench-survivor",
      unlockType: "title",
      contentId: "title.workbench-survivor",
      condition: { type: "account_level", minimum: 2 },
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
    decisions: [
      {
        id: "outskirts-crossroads",
        kind: "route",
        choices: [
          { id: "safe-trail", kind: "safe", risk: 12, reward: 20, healPercent: 4 },
          { id: "hazard-yard", kind: "risky", risk: 38, reward: 70, damagePercent: 4 },
        ],
      },
      {
        id: "old-workbench",
        kind: "event",
        choices: [
          { id: "field-repair", kind: "rest", risk: 5, reward: 25, healPercent: 18 },
          { id: "mystery-cache", kind: "mystery", risk: 32, reward: 95, damagePercent: 7 },
        ],
      },
      {
        id: "ogre-gate",
        kind: "route",
        choices: [
          { id: "reinforced-gate", kind: "safe", risk: 15, reward: 35, healPercent: 5 },
          { id: "overdrive-route", kind: "risky", risk: 48, reward: 125, damagePercent: 8 },
        ],
      },
    ],
  },
};

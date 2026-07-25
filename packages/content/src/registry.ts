import { HERO_CLASS_IDS, type GameContent } from "@discord-hero/game-core";
import { DEFAULT_CONTENT } from "./default-content.js";

const REGISTERED_CONTENT: readonly GameContent[] = [DEFAULT_CONTENT];

export const CURRENT_CONTENT = DEFAULT_CONTENT;

export function resolveGameContent(
  rulesetVersion: string,
  contentVersion: string,
): GameContent | null {
  return (
    REGISTERED_CONTENT.find(
      (content) => content.rulesetVersion === rulesetVersion && content.version === contentVersion,
    ) ?? null
  );
}

export function validateGameContent(content: GameContent): readonly string[] {
  const issues: string[] = [];
  if (content.version.length === 0) {
    issues.push("content version is empty");
  }
  if (content.rulesetVersion.length === 0) {
    issues.push("ruleset version is empty");
  }

  for (const classId of HERO_CLASS_IDS) {
    const definition = content.classes[classId];
    if (definition.id !== classId) {
      issues.push(`class key ${classId} does not match id ${definition.id}`);
    }
    if (definition.maxHp <= 0 || definition.attackPower <= 0 || definition.attackIntervalMs <= 0) {
      issues.push(`class ${classId} has non-positive combat values`);
    }
    for (const skillId of definition.skillIds) {
      const skill = content.skills[skillId];
      if (skill === undefined) {
        issues.push(`class ${classId} references missing skill ${skillId}`);
      } else if (skill.classId !== classId) {
        issues.push(`skill ${skillId} belongs to ${skill.classId}, not ${classId}`);
      }
    }
    for (const equipmentId of definition.equipmentIds) {
      const equipment = content.equipment[equipmentId];
      if (equipment === undefined) {
        issues.push(`class ${classId} references missing equipment ${equipmentId}`);
      } else if (!equipment.allowedClassIds.includes(classId)) {
        issues.push(`equipment ${equipmentId} is not allowed for class ${classId}`);
      }
    }
  }

  for (const [equipmentId, equipment] of Object.entries(content.equipment)) {
    if (equipment.id !== equipmentId) {
      issues.push(`equipment key ${equipmentId} does not match id ${equipment.id}`);
    }
    if (equipment.allowedClassIds.length === 0 || equipment.tags.length === 0) {
      issues.push(`equipment ${equipmentId} must have an allowed class and tag`);
    }
    for (const classId of equipment.allowedClassIds) {
      if (!HERO_CLASS_IDS.includes(classId)) {
        issues.push(`equipment ${equipmentId} references unknown class ${classId}`);
      }
    }
    validateEquipmentEffects(equipmentId, equipment.effects, issues);
  }

  for (const [synergyId, synergy] of Object.entries(content.equipmentSynergies)) {
    if (synergy.id !== synergyId) {
      issues.push(`equipment synergy key ${synergyId} does not match id ${synergy.id}`);
    }
    if (synergy.requiredEquipmentTags.length === 0) {
      issues.push(`equipment synergy ${synergyId} has no equipment tags`);
    }
    for (const skillId of synergy.requiredSkillIds) {
      if (content.skills[skillId] === undefined) {
        issues.push(`equipment synergy ${synergyId} references missing skill ${skillId}`);
      }
    }
    validateEquipmentEffects(synergyId, synergy.effects, issues);
  }

  for (const [skillId, skill] of Object.entries(content.skills)) {
    if (skill.id !== skillId) {
      issues.push(`skill key ${skillId} does not match id ${skill.id}`);
    }
    if (skill.cooldownMs <= 0 || skill.effect.power <= 0) {
      issues.push(`skill ${skillId} has non-positive values`);
    }
    if (!content.classes[skill.classId].skillIds.includes(skillId)) {
      issues.push(`skill ${skillId} is not assigned to class ${skill.classId}`);
    }
  }

  for (const [enemyId, enemy] of Object.entries(content.enemies)) {
    if (enemy.id !== enemyId) {
      issues.push(`enemy key ${enemyId} does not match id ${enemy.id}`);
    }
    if (enemy.maxHp <= 0 || enemy.attackPower < 0 || enemy.attackIntervalMs <= 0) {
      issues.push(`enemy ${enemyId} has invalid combat values`);
    }
  }

  for (const wave of content.stage.waves) {
    if (wave.enemyDefinitionIds.length === 0) {
      issues.push("stage contains an empty wave");
    }
    for (const enemyId of wave.enemyDefinitionIds) {
      if (content.enemies[enemyId] === undefined) {
        issues.push(`stage references missing enemy ${enemyId}`);
      }
    }
  }

  const decisionIds = new Set<string>();
  for (const decision of content.stage.decisions ?? []) {
    if (decisionIds.has(decision.id)) {
      issues.push(`stage contains duplicate decision ${decision.id}`);
    }
    decisionIds.add(decision.id);
    if (decision.choices.length === 0) {
      issues.push(`decision ${decision.id} contains no choices`);
    }
    const choiceIds = new Set<string>();
    for (const choice of decision.choices) {
      if (choiceIds.has(choice.id)) {
        issues.push(`decision ${decision.id} contains duplicate choice ${choice.id}`);
      }
      choiceIds.add(choice.id);
      if (choice.risk < 0 || choice.risk > 100 || choice.reward < 0) {
        issues.push(`decision choice ${choice.id} has invalid risk or reward`);
      }
      if (
        (choice.healPercent !== undefined &&
          (choice.healPercent < 0 || choice.healPercent > 100)) ||
        (choice.damagePercent !== undefined &&
          (choice.damagePercent < 0 || choice.damagePercent > 100))
      ) {
        issues.push(`decision choice ${choice.id} has invalid effect percentage`);
      }
    }
  }

  for (const [upgradeId, upgrade] of Object.entries(content.upgrades)) {
    if (upgrade.id !== upgradeId) {
      issues.push(`upgrade key ${upgradeId} does not match id ${upgrade.id}`);
    }
  }

  for (const [unlockId, unlock] of Object.entries(content.unlocks)) {
    if (unlock.id !== unlockId) {
      issues.push(`unlock key ${unlockId} does not match id ${unlock.id}`);
    }
    if (unlock.unlockType.length === 0 || unlock.contentId.length === 0) {
      issues.push(`unlock ${unlockId} must have a type and content ID`);
    }
    switch (unlock.condition.type) {
      case "match_outcome":
        if (!(["victory", "return", "defeat"] as const).includes(unlock.condition.outcome)) {
          issues.push(`unlock ${unlockId} has an invalid match outcome`);
        }
        break;
      case "account_level":
        if (!Number.isInteger(unlock.condition.minimum) || unlock.condition.minimum < 1) {
          issues.push(`unlock ${unlockId} has an invalid account level condition`);
        }
        break;
    }
  }

  for (const outcome of ["victory", "return", "defeat"] as const) {
    if (content.rewardPolicy.currencyBaseByOutcome[outcome] < 0) {
      issues.push(`reward policy ${outcome} has a negative currency base`);
    }
    if (content.rewardPolicy.experienceBaseByOutcome[outcome] < 0) {
      issues.push(`reward policy ${outcome} has a negative experience base`);
    }
  }
  if (
    content.rewardPolicy.currencyPerWave < 0 ||
    content.rewardPolicy.currencyPerScore < 0 ||
    content.rewardPolicy.experiencePerWave < 0 ||
    content.rewardPolicy.experiencePerEnemyDefeated < 0
  ) {
    issues.push("reward policy contains a negative progression value");
  }

  return issues;
}

function validateEquipmentEffects(
  ownerId: string,
  effects: readonly GameContent["equipment"][string]["effects"][number][],
  issues: string[],
): void {
  for (const effect of effects) {
    switch (effect.type) {
      case "attack_power_bonus":
      case "max_hp_bonus":
      case "shield_on_wave":
        if (effect.amount < 0) {
          issues.push(`equipment effect ${ownerId} has a negative amount`);
        }
        break;
      case "attack_interval_multiplier":
      case "skill_cooldown_multiplier":
      case "healing_multiplier":
      case "rescue_duration_multiplier":
        if (effect.multiplier <= 0) {
          issues.push(`equipment effect ${ownerId} has a non-positive multiplier`);
        }
        break;
    }
  }
}

function assertRegisteredContentIsValid(): void {
  const versionKeys = new Set<string>();
  for (const content of REGISTERED_CONTENT) {
    const key = `${content.rulesetVersion}:${content.version}`;
    if (versionKeys.has(key)) {
      throw new Error(`Duplicate registered content version: ${key}`);
    }
    versionKeys.add(key);
    const issues = validateGameContent(content);
    if (issues.length > 0) {
      throw new Error(`Invalid registered content ${key}: ${issues.join("; ")}`);
    }
  }
}

assertRegisteredContentIsValid();

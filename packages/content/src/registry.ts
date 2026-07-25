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

  for (const [upgradeId, upgrade] of Object.entries(content.upgrades)) {
    if (upgrade.id !== upgradeId) {
      issues.push(`upgrade key ${upgradeId} does not match id ${upgrade.id}`);
    }
  }

  return issues;
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

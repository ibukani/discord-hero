import { describe, expect, it } from "vitest";
import type { GameContent } from "@discord-hero/game-core";
import {
  CURRENT_CONTENT,
  DEFAULT_CONTENT,
  resolveGameContent,
  validateGameContent,
} from "../src/index.js";

describe("default content", () => {
  it("references existing skills and enemies", () => {
    for (const classDefinition of Object.values(DEFAULT_CONTENT.classes)) {
      for (const skillId of classDefinition.skillIds) {
        expect(DEFAULT_CONTENT.skills[skillId]).toBeDefined();
      }
    }

    for (const wave of DEFAULT_CONTENT.stage.waves) {
      for (const enemyId of wave.enemyDefinitionIds) {
        expect(DEFAULT_CONTENT.enemies[enemyId]).toBeDefined();
      }
    }

    for (const decision of DEFAULT_CONTENT.stage.decisions ?? []) {
      expect(decision.choices.length).toBeGreaterThan(0);
      for (const choice of decision.choices) {
        expect(choice.id).toBeTruthy();
      }
    }
  });

  it("is registered by an exact ruleset and content version pair", () => {
    expect(resolveGameContent(CURRENT_CONTENT.rulesetVersion, CURRENT_CONTENT.version)).toBe(
      CURRENT_CONTENT,
    );
    expect(resolveGameContent(CURRENT_CONTENT.rulesetVersion, "unknown")).toBeNull();
    expect(resolveGameContent("unknown", CURRENT_CONTENT.version)).toBeNull();
  });

  it("passes the full content integrity validator", () => {
    expect(validateGameContent(DEFAULT_CONTENT)).toEqual([]);
  });

  it("reports missing cross references", () => {
    const invalid: GameContent = {
      ...DEFAULT_CONTENT,
      classes: {
        ...DEFAULT_CONTENT.classes,
        mage: {
          ...DEFAULT_CONTENT.classes.mage,
          skillIds: ["mage.missing"],
        },
      },
      stage: {
        ...DEFAULT_CONTENT.stage,
        waves: [{ enemyDefinitionIds: ["missing-enemy"] }],
      },
    };

    expect(validateGameContent(invalid)).toEqual(
      expect.arrayContaining([
        "class mage references missing skill mage.missing",
        "stage references missing enemy missing-enemy",
      ]),
    );
  });

  it("validates equipment availability and synergy references", () => {
    const invalid: GameContent = {
      ...DEFAULT_CONTENT,
      classes: {
        ...DEFAULT_CONTENT.classes,
        guardian: {
          ...DEFAULT_CONTENT.classes.guardian,
          equipmentIds: ["equipment.missing"],
        },
      },
      equipment: {
        ...DEFAULT_CONTENT.equipment,
        "equipment.invalid": {
          id: "equipment.invalid",
          slot: "weapon",
          allowedClassIds: ["guardian"],
          tags: [],
          effects: [{ type: "attack_power_bonus", amount: -1 }],
        },
      },
      equipmentSynergies: {
        ...DEFAULT_CONTENT.equipmentSynergies,
        "synergy.invalid": {
          id: "synergy.invalid",
          requiredEquipmentTags: ["missing-tag"],
          requiredSkillIds: ["skill.missing"],
          effects: [{ type: "skill_cooldown_multiplier", multiplier: 0 }],
        },
      },
      rewardPolicy: {
        ...DEFAULT_CONTENT.rewardPolicy,
        currencyPerWave: -1,
      },
    };

    expect(validateGameContent(invalid)).toEqual(
      expect.arrayContaining([
        "class guardian references missing equipment equipment.missing",
        "equipment equipment.invalid must have an allowed class and tag",
        "equipment effect equipment.invalid has a negative amount",
        "equipment synergy synergy.invalid references missing skill skill.missing",
        "equipment effect synergy.invalid has a non-positive multiplier",
        "reward policy contains a negative progression value",
      ]),
    );
  });
});

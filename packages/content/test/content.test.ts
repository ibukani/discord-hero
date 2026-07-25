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
});

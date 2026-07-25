import { describe, expect, it } from "vitest";
import { DEFAULT_CONTENT } from "../src/default-content.js";

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
});

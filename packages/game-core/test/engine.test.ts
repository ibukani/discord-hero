import { describe, expect, it } from "vitest";
import type { GameContent } from "../src/content.js";
import type { GameState } from "../src/types.js";
import { applyCommand, cloneState, createGame, stepGame } from "../src/engine.js";
import { actionId, matchId, playerId } from "../src/ids.js";

const content: GameContent = {
  version: "test-content",
  rulesetVersion: "test-rules",
  classes: {
    guardian: {
      id: "guardian",
      maxHp: 100,
      attackPower: 10,
      attackIntervalMs: 100,
      skillIds: ["guardian.hit"],
    },
    ranger: {
      id: "ranger",
      maxHp: 100,
      attackPower: 10,
      attackIntervalMs: 100,
      skillIds: ["ranger.hit"],
    },
    mage: {
      id: "mage",
      maxHp: 100,
      attackPower: 10,
      attackIntervalMs: 100,
      skillIds: ["mage.hit"],
    },
    support: {
      id: "support",
      maxHp: 100,
      attackPower: 10,
      attackIntervalMs: 100,
      skillIds: ["support.heal"],
    },
  },
  skills: {
    "guardian.hit": {
      id: "guardian.hit",
      classId: "guardian",
      cooldownMs: 100,
      effect: { type: "damage_single", power: 25 },
    },
    "ranger.hit": {
      id: "ranger.hit",
      classId: "ranger",
      cooldownMs: 100,
      effect: { type: "damage_single", power: 25 },
    },
    "mage.hit": {
      id: "mage.hit",
      classId: "mage",
      cooldownMs: 100,
      effect: { type: "damage_single", power: 25 },
    },
    "support.heal": {
      id: "support.heal",
      classId: "support",
      cooldownMs: 100,
      effect: { type: "heal_all", power: 25 },
    },
  },
  enemies: {
    target: {
      id: "target",
      maxHp: 20,
      attackPower: 0,
      attackIntervalMs: 1_000,
      experience: 50,
      score: 10,
      boss: false,
    },
  },
  upgrades: {
    "power.training": { id: "power.training", attackMultiplier: 1.2 },
    "vitality.training": { id: "vitality.training", maxHpBonus: 10 },
    "tempo.training": { id: "tempo.training", skillCooldownMultiplier: 0.9 },
    "team.restoration": { id: "team.restoration", healingMultiplier: 1.2 },
  },
  stage: {
    id: "test-stage",
    waves: [{ enemyDefinitionIds: ["target"] }],
  },
};

function createStartedGame(): GameState {
  const id = playerId("player-1");
  let state = createGame({ matchId: matchId("match-1"), seed: "seed", content });
  state = applyCommand(
    state,
    {
      type: "join_player",
      actionId: actionId("join-1"),
      playerId: id,
      displayName: "Player",
      classId: "guardian",
    },
    content,
  ).state;
  state = applyCommand(
    state,
    {
      type: "set_ready",
      actionId: actionId("ready-1"),
      playerId: id,
      ready: true,
    },
    content,
  ).state;
  state = applyCommand(
    state,
    {
      type: "start_match",
      actionId: actionId("start-1"),
      playerId: id,
    },
    content,
  ).state;
  return state;
}

describe("game engine", () => {
  it("produces the same result for the same seed and commands", () => {
    let first = createStartedGame();
    let second = createStartedGame();

    for (let index = 0; index < 10; index += 1) {
      first = stepGame(first, 100, content).state;
      second = stepGame(second, 100, content).state;
    }

    expect(second).toEqual(first);
  });

  it("ignores a duplicate action identifier", () => {
    const state = createStartedGame();
    const command = {
      type: "cast_skill" as const,
      actionId: actionId("skill-1"),
      playerId: playerId("player-1"),
      skillId: "guardian.hit",
    };

    const first = applyCommand(state, command, content);
    const second = applyCommand(first.state, command, content);

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(second.state).toBe(first.state);
    expect(second.events).toEqual([]);
  });

  it("rejects a skill from a different class", () => {
    const state = createStartedGame();
    const result = applyCommand(
      state,
      {
        type: "cast_skill",
        actionId: actionId("wrong-skill"),
        playerId: playerId("player-1"),
        skillId: "mage.hit",
      },
      content,
    );

    expect(result.accepted).toBe(false);
    expect(result.errorCode).toBe("skill_not_available");
  });

  it("does not mutate state when a command is rejected", () => {
    const state = createStartedGame();
    const before = cloneState(state);
    const result = applyCommand(
      state,
      {
        type: "select_class",
        actionId: actionId("late-class-change"),
        playerId: playerId("player-1"),
        classId: "mage",
      },
      content,
    );

    expect(result.accepted).toBe(false);
    expect(result.state).toBe(state);
    expect(state).toEqual(before);
  });

  it("enforces the four-player room invariant", () => {
    let state = createGame({ matchId: matchId("match-capacity"), seed: "capacity", content });
    for (let index = 1; index <= 4; index += 1) {
      const result = applyCommand(
        state,
        {
          type: "join_player",
          actionId: actionId(`join-${index}`),
          playerId: playerId(`player-${index}`),
          displayName: `Player ${index}`,
          classId: "guardian",
        },
        content,
      );
      expect(result.accepted).toBe(true);
      state = result.state;
    }

    const overflow = applyCommand(
      state,
      {
        type: "join_player",
        actionId: actionId("join-5"),
        playerId: playerId("player-5"),
        displayName: "Player 5",
        classId: "guardian",
      },
      content,
    );
    expect(overflow.accepted).toBe(false);
    expect(overflow.errorCode).toBe("room_full");
    expect(Object.keys(overflow.state.players)).toHaveLength(4);
  });

  it("keeps simulation health and result values within valid bounds", () => {
    let state = createStartedGame();
    for (let index = 0; index < 1_000 && state.status === "running"; index += 1) {
      state = stepGame(state, 100, content).state;
      for (const player of Object.values(state.players)) {
        expect(player.hp).toBeGreaterThanOrEqual(0);
        expect(player.hp).toBeLessThanOrEqual(player.maxHp);
        expect(player.shield).toBeGreaterThanOrEqual(0);
      }
      for (const enemy of Object.values(state.enemies)) {
        expect(enemy.hp).toBeGreaterThanOrEqual(0);
        expect(enemy.hp).toBeLessThanOrEqual(enemy.maxHp);
      }
    }

    expect(state.status).toBe("victory");
    expect(state.result?.outcome).toBe("victory");
    expect(state.result?.durationMs).toBe(state.elapsedMs);
  });

  it("bounds the remembered action identifier window", () => {
    const id = playerId("player-1");
    let state = createGame({ matchId: matchId("match-actions"), seed: "actions", content });
    state = applyCommand(
      state,
      {
        type: "join_player",
        actionId: actionId("join-player"),
        playerId: id,
        displayName: "Player",
        classId: "guardian",
      },
      content,
    ).state;

    for (let index = 0; index < 600; index += 1) {
      state = applyCommand(
        state,
        {
          type: "set_ready",
          actionId: actionId(`ready-${index}`),
          playerId: id,
          ready: index % 2 === 0,
        },
        content,
      ).state;
    }

    expect(state.processedActionIds).toHaveLength(512);
    expect(state.processedActionIds.at(-1)).toBe("ready-599");
  });
});

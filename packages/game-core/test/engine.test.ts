import { describe, expect, it } from "vitest";
import type { GameContent } from "../src/content.js";
import type { GameState } from "../src/types.js";
import {
  applyCommand,
  cloneState,
  createGame,
  RESCUE_ACTION_DURATION_MS,
  RESCUE_WINDOW_DURATION_MS,
  stepGame,
} from "../src/engine.js";
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
      equipmentIds: [],
    },
    ranger: {
      id: "ranger",
      maxHp: 100,
      attackPower: 10,
      attackIntervalMs: 100,
      skillIds: ["ranger.hit"],
      equipmentIds: [],
    },
    mage: {
      id: "mage",
      maxHp: 100,
      attackPower: 10,
      attackIntervalMs: 100,
      skillIds: ["mage.hit"],
      equipmentIds: [],
    },
    support: {
      id: "support",
      maxHp: 100,
      attackPower: 10,
      attackIntervalMs: 100,
      skillIds: ["support.heal"],
      equipmentIds: [],
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
  equipment: {},
  equipmentSynergies: {},
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
  rewardPolicy: {
    currencyBaseByOutcome: { victory: 100, return: 50, defeat: 10 },
    experienceBaseByOutcome: { victory: 80, return: 30, defeat: 5 },
    currencyPerWave: 10,
    currencyPerScore: 0.1,
    experiencePerWave: 15,
    experiencePerEnemyDefeated: 3,
  },
  unlocks: {
    "achievement.test-victory": {
      id: "achievement.test-victory",
      unlockType: "achievement",
      contentId: "achievement.test-victory",
      condition: { type: "match_outcome", outcome: "victory" },
    },
    "title.test-level-two": {
      id: "title.test-level-two",
      unlockType: "title",
      contentId: "title.test-level-two",
      condition: { type: "account_level", minimum: 2 },
    },
  },
  stage: {
    id: "test-stage",
    waves: [{ enemyDefinitionIds: ["target"] }],
  },
};

const decisionContent: GameContent = {
  ...content,
  stage: {
    ...content.stage,
    waves: [...content.stage.waves, { enemyDefinitionIds: ["target"] }],
    decisions: [
      {
        id: "first-route",
        kind: "route",
        choices: [
          { id: "safe-route", kind: "safe", risk: 5, reward: 20 },
          { id: "risky-route", kind: "risky", risk: 50, reward: 100 },
        ],
      },
    ],
  },
};

const equipmentContent: GameContent = {
  ...content,
  classes: {
    ...content.classes,
    guardian: {
      ...content.classes.guardian,
      equipmentIds: ["weapon.test", "armor.test", "accessory.test"],
    },
  },
  equipment: {
    "weapon.test": {
      id: "weapon.test",
      slot: "weapon",
      allowedClassIds: ["guardian"],
      tags: ["barrier"],
      effects: [{ type: "attack_power_bonus", amount: 5 }],
    },
    "armor.test": {
      id: "armor.test",
      slot: "armor",
      allowedClassIds: ["guardian"],
      tags: ["plate"],
      effects: [{ type: "max_hp_bonus", amount: 20 }],
    },
    "accessory.test": {
      id: "accessory.test",
      slot: "accessory",
      allowedClassIds: ["guardian"],
      tags: ["resonant"],
      effects: [{ type: "skill_cooldown_multiplier", multiplier: 0.8 }],
    },
  },
  equipmentSynergies: {
    "synergy.test": {
      id: "synergy.test",
      requiredEquipmentTags: ["barrier"],
      requiredSkillIds: ["guardian.hit"],
      effects: [{ type: "shield_on_wave", amount: 7 }],
    },
  },
};

function createStartedGame(gameContent: GameContent = content): GameState {
  const id = playerId("player-1");
  let state = createGame({ matchId: matchId("match-1"), seed: "seed", content: gameContent });
  state = applyCommand(
    state,
    {
      type: "join_player",
      actionId: actionId("join-1"),
      playerId: id,
      displayName: "Player",
      classId: "guardian",
    },
    gameContent,
  ).state;
  state = applyCommand(
    state,
    {
      type: "set_ready",
      actionId: actionId("ready-1"),
      playerId: id,
      ready: true,
    },
    gameContent,
  ).state;
  state = applyCommand(
    state,
    {
      type: "start_match",
      actionId: actionId("start-1"),
      playerId: id,
    },
    gameContent,
  ).state;
  return state;
}

function createStartedParty(gameContent: GameContent = content): GameState {
  let state = createGame({
    matchId: matchId("party-match"),
    seed: "party-seed",
    content: gameContent,
  });
  for (const [index, id] of ["player-1", "player-2"].entries()) {
    state = applyCommand(
      state,
      {
        type: "join_player",
        actionId: actionId(`party-join-${index}`),
        playerId: playerId(id),
        displayName: `Player ${index + 1}`,
        classId: index === 0 ? "guardian" : "support",
      },
      gameContent,
    ).state;
  }
  for (const [index, id] of ["player-1", "player-2"].entries()) {
    state = applyCommand(
      state,
      {
        type: "set_ready",
        actionId: actionId(`party-ready-${index}`),
        playerId: playerId(id),
        ready: true,
      },
      gameContent,
    ).state;
  }
  return applyCommand(
    state,
    {
      type: "start_match",
      actionId: actionId("party-start"),
      playerId: playerId("player-1"),
    },
    gameContent,
  ).state;
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

  it("scales a running late joiner from the party level and applies a validated profile", () => {
    const first = createStartedGame(equipmentContent);
    const firstPlayer = first.players["player-1"];
    if (firstPlayer === undefined) {
      throw new Error("Expected the initial player");
    }
    firstPlayer.level = 4;
    firstPlayer.automation = {
      growth: "survival",
      progress: "balanced",
      retreat: "standard",
      rescue: "standard",
    };
    const profile = {
      loadout: {
        activeSkillIds: ["guardian.hit"],
        weaponId: "weapon.test",
        armorId: "armor.test",
        accessoryId: "accessory.test",
      },
      automation: {
        growth: "offense" as const,
        progress: "reward" as const,
        retreat: "last_stand" as const,
        rescue: "priority" as const,
      },
      unlockedContentIds: [],
    };

    const second = applyCommand(
      first,
      {
        type: "join_player",
        actionId: actionId("late-join"),
        playerId: playerId("player-2"),
        displayName: "Late Player",
        classId: "guardian",
        profile,
      },
      equipmentContent,
    );

    expect(second.accepted).toBe(true);
    const latePlayer = second.state.players["player-2"];
    expect(latePlayer?.level).toBe(4);
    expect(latePlayer?.loadout).toEqual(profile.loadout);
    expect(latePlayer?.automation).toEqual(profile.automation);
    expect(latePlayer?.upgrades).toHaveLength(3);
    expect(second.events).toContainEqual({ type: "player_joined", playerId: "player-2" });
    expect(second.events.filter((event) => event.type === "upgrade_selected")).toHaveLength(3);

    const replay = applyCommand(
      cloneState(first),
      {
        type: "join_player",
        actionId: actionId("late-join"),
        playerId: playerId("player-2"),
        displayName: "Late Player",
        classId: "guardian",
        profile,
      },
      equipmentContent,
    );
    expect(replay).toEqual(second);

    const partialProfile = applyCommand(
      second.state,
      {
        type: "join_player",
        actionId: actionId("late-join-partial-profile"),
        playerId: playerId("player-3"),
        displayName: "Partial Profile",
        classId: "guardian",
        profile: {
          loadout: {
            activeSkillIds: ["mage.hit"],
            weaponId: "weapon.test",
            armorId: "armor.test",
            accessoryId: "accessory.test",
          },
          automation: null,
          unlockedContentIds: [],
        },
      },
      equipmentContent,
    );
    expect(partialProfile.state.players["player-3"]?.loadout).toEqual({
      activeSkillIds: ["guardian.hit"],
      weaponId: "weapon.test",
      armorId: "armor.test",
      accessoryId: "accessory.test",
    });
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
    expect(state.result?.rewards["player-1"]).toEqual({ currency: 113, experience: 98 });
    expect(state.result?.unlocks["player-1"]).toEqual(["achievement.test-victory"]);
    expect(state.players["player-1"]?.unlockedContentIds).toEqual(["achievement.test-victory"]);
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

  it("applies automatic skills and growth without waiting for player input", () => {
    const state = createStartedGame();
    const result = stepGame(state, 100, content);
    const player = result.state.players["player-1"];

    expect(result.events.some((event) => event.type === "skill_used")).toBe(true);
    expect(result.events.some((event) => event.type === "upgrade_selected")).toBe(true);
    expect(player?.level).toBeGreaterThan(1);
    expect(player?.pendingUpgradeChoices).toEqual([]);
  });

  it("stores automation policy changes only in the lobby", () => {
    const state = createStartedGame();
    const player = playerId("player-1");
    const result = applyCommand(
      state,
      {
        type: "set_automation_policy",
        actionId: actionId("policy-1"),
        playerId: player,
        policy: { growth: "survival", progress: "safe", retreat: "early", rescue: "priority" },
      },
      content,
    );

    expect(result.accepted).toBe(false);
    expect(result.errorCode).toBe("match_already_started");

    let lobby = createGame({ matchId: matchId("policy-lobby"), seed: "policy", content });
    lobby = applyCommand(
      lobby,
      {
        type: "join_player",
        actionId: actionId("policy-join"),
        playerId: player,
        displayName: "Player",
        classId: "guardian",
      },
      content,
    ).state;
    const accepted = applyCommand(
      lobby,
      {
        type: "set_automation_policy",
        actionId: actionId("policy-accepted"),
        playerId: player,
        policy: { growth: "survival", progress: "safe", retreat: "early", rescue: "priority" },
      },
      content,
    );

    expect(accepted.accepted).toBe(true);
    expect(accepted.state.players[player]?.automation).toEqual({
      growth: "survival",
      progress: "safe",
      retreat: "early",
      rescue: "priority",
    });
  });

  it("resolves route decisions from automation policies deterministically", () => {
    const first = stepGame(createStartedGame(decisionContent), 4_000, decisionContent).state;
    const second = stepGame(createStartedGame(decisionContent), 4_000, decisionContent).state;

    expect(first).toEqual(second);
    expect(first.decisionIndex).toBe(1);
    expect(first.lastDecision).toEqual({
      kind: "route",
      decisionId: "first-route",
      choiceId: "risky-route",
      risk: 50,
      reward: 100,
      voterCount: 1,
      totalVoters: 1,
      policy: "balanced",
    });
    expect(first.players["player-1"]?.score).toBe(130);
  });

  it("returns the party instead of declaring defeat when the retreat policy triggers", () => {
    const state = createStartedGame(decisionContent);
    const player = state.players["player-1"];
    if (player === undefined) {
      throw new Error("Expected player to exist");
    }
    player.hp = 20;

    const result = stepGame(state, 4_000, decisionContent);

    expect(result.state.status).toBe("return");
    expect(result.state.result?.outcome).toBe("return");
    expect(result.events).toContainEqual({
      type: "retreat_decided",
      policy: "standard",
      reason: "health_threshold",
      averageHpPercent: 20,
    });
  });

  it("allows an explicit decision override without creating an input wait", () => {
    const state = createStartedGame(decisionContent);
    const result = applyCommand(
      state,
      {
        type: "override_decision",
        actionId: actionId("decision-override"),
        playerId: playerId("player-1"),
        decisionId: "first-route",
        choiceId: "safe-route",
      },
      decisionContent,
    );

    expect(result.accepted).toBe(true);
    expect(result.state.activeDecision).toBeNull();
    expect(result.state.lastDecision?.choiceId).toBe("safe-route");
    expect(result.events.some((event) => event.type === "decision_overridden")).toBe(true);
    expect(result.events.some((event) => event.type === "decision_resolved")).toBe(true);
    expect(result.events.some((event) => event.type === "wave_spawned")).toBe(true);
  });

  it("validates and preserves a lobby skill loadout", () => {
    let state = createGame({ matchId: matchId("loadout"), seed: "loadout", content });
    const id = playerId("player-1");
    state = applyCommand(
      state,
      {
        type: "join_player",
        actionId: actionId("loadout-join"),
        playerId: id,
        displayName: "Player",
        classId: "guardian",
      },
      content,
    ).state;
    const invalid = applyCommand(
      state,
      {
        type: "set_loadout",
        actionId: actionId("loadout-invalid"),
        playerId: id,
        activeSkillIds: ["mage.hit"],
      },
      content,
    );
    expect(invalid.accepted).toBe(false);
    expect(invalid.errorCode).toBe("skill_not_available");

    const accepted = applyCommand(
      state,
      {
        type: "set_loadout",
        actionId: actionId("loadout-valid"),
        playerId: id,
        activeSkillIds: ["guardian.hit"],
      },
      content,
    );
    expect(accepted.accepted).toBe(true);
    expect(accepted.state.players[id]?.loadout.activeSkillIds).toEqual(["guardian.hit"]);
  });

  it("applies authoritative equipment effects and skill synergies", () => {
    let state = createGame({
      matchId: matchId("equipment"),
      seed: "equipment-seed",
      content: equipmentContent,
    });
    const id = playerId("player-1");
    state = applyCommand(
      state,
      {
        type: "join_player",
        actionId: actionId("equipment-join"),
        playerId: id,
        displayName: "Player",
        classId: "guardian",
      },
      equipmentContent,
    ).state;

    const initialPlayer = state.players[id];
    expect(initialPlayer?.loadout).toEqual({
      activeSkillIds: ["guardian.hit"],
      weaponId: "weapon.test",
      armorId: "armor.test",
      accessoryId: "accessory.test",
    });
    expect(initialPlayer?.attackPower).toBe(15);
    expect(initialPlayer?.maxHp).toBe(120);
    expect(initialPlayer?.skillCooldownMultiplier).toBe(0.8);
    expect(initialPlayer?.activeSynergyIds).toEqual(["synergy.test"]);

    const equipment = applyCommand(
      state,
      {
        type: "set_equipment",
        actionId: actionId("equipment-set"),
        playerId: id,
        weaponId: null,
        armorId: "armor.test",
        accessoryId: "accessory.test",
      },
      equipmentContent,
    );
    expect(equipment.accepted).toBe(true);
    expect(equipment.events).toContainEqual({
      type: "equipment_changed",
      playerId: id,
      weaponId: null,
      armorId: "armor.test",
      accessoryId: "accessory.test",
      synergyIds: [],
    });
    expect(equipment.state.players[id]?.attackPower).toBe(10);
    expect(equipment.state.players[id]?.maxHp).toBe(120);

    const invalidSlot = applyCommand(
      state,
      {
        type: "set_equipment",
        actionId: actionId("equipment-invalid-slot"),
        playerId: id,
        weaponId: "armor.test",
        armorId: "armor.test",
        accessoryId: "accessory.test",
      },
      equipmentContent,
    );
    expect(invalidSlot.accepted).toBe(false);
    expect(invalidSlot.errorCode).toBe("equipment_slot_mismatch");

    const ready = applyCommand(
      state,
      { type: "set_ready", actionId: actionId("equipment-ready"), playerId: id, ready: true },
      equipmentContent,
    ).state;
    const started = applyCommand(
      ready,
      { type: "start_match", actionId: actionId("equipment-start"), playerId: id },
      equipmentContent,
    );
    expect(started.accepted).toBe(true);
    expect(started.state.players[id]?.shield).toBe(7);
    const waveState = started.state;
    const withSynergy = applyCommand(
      waveState,
      {
        type: "set_equipment",
        actionId: actionId("equipment-late"),
        playerId: id,
        weaponId: "weapon.test",
        armorId: "armor.test",
        accessoryId: "accessory.test",
      },
      equipmentContent,
    );
    expect(withSynergy.accepted).toBe(false);
    expect(withSynergy.errorCode).toBe("match_already_started");
  });

  it("turns lethal damage into a rescue window before defeat", () => {
    const targetEnemy = content.enemies["target"];
    if (targetEnemy === undefined) {
      throw new Error("Expected target enemy to exist");
    }
    const dangerousContent: GameContent = {
      ...content,
      enemies: {
        target: {
          ...targetEnemy,
          maxHp: 1_000,
          attackPower: 200,
          attackIntervalMs: 100,
        },
      },
    };
    const result = stepGame(createStartedGame(dangerousContent), 100, dangerousContent);
    const player = result.state.players["player-1"];

    expect(player?.downed).toBe(true);
    expect(player?.eliminated).toBe(false);
    expect(player?.rescueDeadlineMs).toBe(result.state.elapsedMs + RESCUE_WINDOW_DURATION_MS);
    expect(result.events).toContainEqual({
      type: "player_downed",
      playerId: "player-1",
      rescueDeadlineMs: result.state.elapsedMs + RESCUE_WINDOW_DURATION_MS,
    });
    expect(result.state.status).toBe("defeat");
  });

  it("auto-rescues a downed teammate and restricts the rescuer during the action", () => {
    const state = createStartedParty();
    const target = state.players["player-2"];
    if (target === undefined) {
      throw new Error("Expected rescue target to exist");
    }
    target.hp = 0;
    target.downed = true;
    target.downedAtMs = state.elapsedMs;
    target.rescueDeadlineMs = state.elapsedMs + RESCUE_WINDOW_DURATION_MS;

    const result = stepGame(state, RESCUE_ACTION_DURATION_MS, content);
    const rescuer = result.state.players["player-1"];
    const rescued = result.state.players["player-2"];

    expect(result.events).toContainEqual({
      type: "rescue_started",
      rescuerId: "player-1",
      targetId: "player-2",
    });
    expect(result.events).toContainEqual({
      type: "player_rescued",
      rescuerId: "player-1",
      targetId: "player-2",
      hp: 35,
    });
    expect(rescued?.downed).toBe(false);
    expect(rescued?.hp).toBe(60);
    expect(rescuer?.rescueTargetId).toBeNull();
    expect(rescuer?.rescueCooldownMs).toBe(4_000);
  });

  it("accepts manual rescue and rejects attacks while rescue is in progress", () => {
    const state = createStartedParty();
    const target = state.players["player-2"];
    if (target === undefined) {
      throw new Error("Expected rescue target to exist");
    }
    target.hp = 0;
    target.downed = true;
    target.downedAtMs = state.elapsedMs;
    target.rescueDeadlineMs = state.elapsedMs + RESCUE_WINDOW_DURATION_MS;

    const rescue = applyCommand(
      state,
      {
        type: "rescue_player",
        actionId: actionId("manual-rescue"),
        playerId: playerId("player-1"),
        targetPlayerId: playerId("player-2"),
      },
      content,
    );
    expect(rescue.accepted).toBe(true);
    expect(rescue.events).toContainEqual({
      type: "rescue_started",
      rescuerId: "player-1",
      targetId: "player-2",
    });

    const blockedSkill = applyCommand(
      rescue.state,
      {
        type: "cast_skill",
        actionId: actionId("skill-during-rescue"),
        playerId: playerId("player-1"),
        skillId: "guardian.hit",
      },
      content,
    );
    expect(blockedSkill.accepted).toBe(false);
    expect(blockedSkill.errorCode).toBe("rescue_in_progress");
  });

  it("expires an unrescued player and keeps the result deterministic", () => {
    const first = createStartedGame();
    const player = first.players["player-1"];
    if (player === undefined) {
      throw new Error("Expected player to exist");
    }
    player.hp = 0;
    player.downed = true;
    player.downedAtMs = first.elapsedMs;
    player.rescueDeadlineMs = first.elapsedMs + RESCUE_WINDOW_DURATION_MS;

    const second = cloneState(first);
    const firstResult = stepGame(first, RESCUE_WINDOW_DURATION_MS, content);
    const secondResult = stepGame(second, RESCUE_WINDOW_DURATION_MS, content);

    expect(firstResult.state).toEqual(secondResult.state);
    expect(firstResult.state.players["player-1"]?.eliminated).toBe(true);
    expect(firstResult.events).toContainEqual({
      type: "player_eliminated",
      playerId: "player-1",
    });
    expect(firstResult.state.status).toBe("defeat");
  });
});

import {
  actionId,
  enemyId,
  matchId,
  playerId,
  type ActiveDecision,
  type DecisionChoicePreview,
  type GameEvent,
  type GameState,
} from "@discord-hero/game-core";
import type { DomainEventDto, GameSnapshot, StoredGameState } from "@discord-hero/protocol";

export function toClientSnapshot(state: GameState): GameSnapshot {
  const players: GameSnapshot["players"] = {};
  for (const [id, player] of Object.entries(state.players)) {
    players[id] = {
      id: player.id,
      displayName: player.displayName,
      classId: player.classId,
      ready: player.ready,
      connection: player.connection,
      hp: player.hp,
      maxHp: player.maxHp,
      shield: player.shield,
      downed: player.downed,
      eliminated: player.eliminated,
      downedAtMs: player.downedAtMs,
      rescueDeadlineMs: player.rescueDeadlineMs,
      rescueTargetId: player.rescueTargetId === null ? null : playerId(player.rescueTargetId),
      rescueProgressMs: player.rescueProgressMs,
      rescueCooldownMs: player.rescueCooldownMs,
      rescueDurationMultiplier: player.rescueDurationMultiplier,
      waveShieldBonus: player.waveShieldBonus,
      activeSynergyIds: [...player.activeSynergyIds],
      level: player.level,
      experience: player.experience,
      nextLevelExperience: player.nextLevelExperience,
      attackPower: player.attackPower,
      loadout: {
        activeSkillIds: [...player.loadout.activeSkillIds],
        weaponId: player.loadout.weaponId,
        armorId: player.loadout.armorId,
        accessoryId: player.loadout.accessoryId,
      },
      automation: { ...player.automation },
      skillCooldowns: { ...player.skillCooldowns },
      upgrades: [...player.upgrades],
      pendingUpgradeChoices: [...player.pendingUpgradeChoices],
      score: player.score,
      stats: { ...player.stats },
    };
  }

  const enemies: GameSnapshot["enemies"] = {};
  for (const [id, enemy] of Object.entries(state.enemies)) {
    enemies[id] = {
      id: enemy.id,
      definitionId: enemy.definitionId,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      attackCooldownMs: enemy.attackCooldownMs,
      boss: enemy.boss,
    };
  }

  return {
    schemaVersion: 1,
    matchId: state.matchId,
    seed: state.seed,
    rulesetVersion: state.rulesetVersion,
    contentVersion: state.contentVersion,
    status: state.status,
    tick: state.tick,
    elapsedMs: state.elapsedMs,
    waveIndex: state.waveIndex,
    decisionIndex: state.decisionIndex,
    activeDecision:
      state.activeDecision === null
        ? null
        : {
            ...state.activeDecision,
            choices: state.activeDecision.choices.map((choice) => ({ ...choice })),
            votes: { ...state.activeDecision.votes },
            overriddenPlayerIds: [...state.activeDecision.overriddenPlayerIds],
          },
    lastDecision: state.lastDecision === null ? null : { ...state.lastDecision },
    players,
    enemies,
    result:
      state.result === null
        ? null
        : {
            ...state.result,
            rewards: Object.fromEntries(
              Object.entries(state.result.rewards).map(([playerId, reward]) => [
                playerId,
                { ...reward },
              ]),
            ),
            unlocks: Object.fromEntries(
              Object.entries(state.result.unlocks).map(([playerId, unlockIds]) => [
                playerId,
                [...unlockIds],
              ]),
            ),
          },
  };
}

export function toStoredGameState(state: GameState): StoredGameState {
  const players: StoredGameState["players"] = {};
  for (const [id, player] of Object.entries(state.players)) {
    players[id] = {
      ...player,
      id: player.id,
      loadout: {
        activeSkillIds: [...player.loadout.activeSkillIds],
        weaponId: player.loadout.weaponId,
        armorId: player.loadout.armorId,
        accessoryId: player.loadout.accessoryId,
      },
      automation: { ...player.automation },
      activeSynergyIds: [...player.activeSynergyIds],
      unlockedContentIds: [...player.unlockedContentIds],
      skillCooldowns: { ...player.skillCooldowns },
      upgrades: [...player.upgrades],
      pendingUpgradeChoices: [...player.pendingUpgradeChoices],
      stats: { ...player.stats },
    };
  }

  const enemies: StoredGameState["enemies"] = {};
  for (const [id, enemy] of Object.entries(state.enemies)) {
    enemies[id] = { ...enemy, id: enemy.id };
  }

  return {
    ...state,
    matchId: state.matchId,
    players,
    enemies,
    processedActionIds: [...state.processedActionIds],
    activeDecision:
      state.activeDecision === null
        ? null
        : {
            ...state.activeDecision,
            choices: state.activeDecision.choices.map((choice) => ({ ...choice })),
            votes: { ...state.activeDecision.votes },
            overriddenPlayerIds: [...state.activeDecision.overriddenPlayerIds],
          },
    lastDecision: state.lastDecision === null ? null : { ...state.lastDecision },
    result:
      state.result === null
        ? null
        : {
            ...state.result,
            rewards: Object.fromEntries(
              Object.entries(state.result.rewards).map(([playerId, reward]) => [
                playerId,
                { ...reward },
              ]),
            ),
            unlocks: Object.fromEntries(
              Object.entries(state.result.unlocks).map(([playerId, unlockIds]) => [
                playerId,
                [...unlockIds],
              ]),
            ),
          },
  };
}

export function fromStoredGameState(stored: StoredGameState): GameState {
  const players: GameState["players"] = {};
  for (const [id, player] of Object.entries(stored.players)) {
    players[id] = {
      ...player,
      id: playerId(player.id),
      rescueTargetId: player.rescueTargetId === null ? null : playerId(player.rescueTargetId),
      loadout: {
        activeSkillIds: [...player.loadout.activeSkillIds],
        weaponId: player.loadout.weaponId,
        armorId: player.loadout.armorId,
        accessoryId: player.loadout.accessoryId,
      },
      automation: { ...player.automation },
      activeSynergyIds: [...player.activeSynergyIds],
      unlockedContentIds: [...player.unlockedContentIds],
      skillCooldowns: { ...player.skillCooldowns },
      upgrades: [...player.upgrades],
      pendingUpgradeChoices: [...player.pendingUpgradeChoices],
      stats: { ...player.stats },
    };
  }

  const enemies: GameState["enemies"] = {};
  for (const [id, enemy] of Object.entries(stored.enemies)) {
    enemies[id] = { ...enemy, id: enemyId(enemy.id) };
  }

  return {
    ...stored,
    matchId: matchId(stored.matchId),
    players,
    enemies,
    processedActionIds: stored.processedActionIds.map((id) => actionId(id)),
    activeDecision: cloneStoredActiveDecision(stored.activeDecision),
    lastDecision: stored.lastDecision === null ? null : { ...stored.lastDecision },
    result:
      stored.result === null
        ? null
        : {
            ...stored.result,
            rewards: Object.fromEntries(
              Object.entries(stored.result.rewards).map(([playerId, reward]) => [
                playerId,
                { ...reward },
              ]),
            ),
            unlocks: Object.fromEntries(
              Object.entries(stored.result.unlocks).map(([playerId, unlockIds]) => [
                playerId,
                [...unlockIds],
              ]),
            ),
          },
  };
}

function cloneStoredActiveDecision(
  source: StoredGameState["activeDecision"],
): ActiveDecision | null {
  if (source === null) {
    return null;
  }
  const choices: DecisionChoicePreview[] = source.choices.map((choice) => ({
    id: choice.id,
    kind: choice.kind,
    risk: choice.risk,
    reward: choice.reward,
    ...(choice.healPercent === undefined ? {} : { healPercent: choice.healPercent }),
    ...(choice.damagePercent === undefined ? {} : { damagePercent: choice.damagePercent }),
  }));
  return {
    kind: source.kind,
    decisionId: source.decisionId,
    choices,
    openedAtMs: source.openedAtMs,
    deadlineMs: source.deadlineMs,
    votes: { ...source.votes },
    overriddenPlayerIds: [...source.overriddenPlayerIds],
  };
}

export function toDomainEvent(event: GameEvent): DomainEventDto {
  switch (event.type) {
    case "player_joined":
      return { type: event.type, playerId: event.playerId };
    case "player_disconnected":
      return { type: event.type, playerId: event.playerId };
    case "player_reconnected":
      return { type: event.type, playerId: event.playerId };
    case "match_started":
      return { type: event.type };
    case "damage":
      return {
        type: event.type,
        sourcePlayerId: event.sourcePlayerId,
        enemyId: event.enemyId,
        targetPlayerId: event.targetPlayerId,
        amount: event.amount,
      };
    case "healing":
      return { type: event.type, sourcePlayerId: event.sourcePlayerId, amount: event.amount };
    case "enemy_defeated":
      return { type: event.type, enemyId: event.enemyId };
    case "wave_spawned":
      return { type: event.type, waveIndex: event.waveIndex };
    case "decision_opened":
      return {
        type: event.type,
        decision: {
          ...event.decision,
          choices: event.decision.choices.map((choice) => ({ ...choice })),
          votes: { ...event.decision.votes },
          overriddenPlayerIds: [...event.decision.overriddenPlayerIds],
        },
      };
    case "decision_overridden":
      return {
        type: event.type,
        playerId: event.playerId,
        decisionId: event.decisionId,
        choiceId: event.choiceId,
      };
    case "decision_resolved":
      return { type: event.type, decision: { ...event.decision } };
    case "retreat_decided":
      return {
        type: event.type,
        policy: event.policy,
        reason: event.reason,
        averageHpPercent: event.averageHpPercent,
      };
    case "player_downed":
      return {
        type: event.type,
        playerId: event.playerId,
        rescueDeadlineMs: event.rescueDeadlineMs,
      };
    case "rescue_started":
      return {
        type: event.type,
        rescuerId: event.rescuerId,
        targetId: event.targetId,
      };
    case "player_rescued":
      return {
        type: event.type,
        rescuerId: event.rescuerId,
        targetId: event.targetId,
        hp: event.hp,
      };
    case "player_eliminated":
      return { type: event.type, playerId: event.playerId };
    case "equipment_changed":
      return {
        type: event.type,
        playerId: event.playerId,
        weaponId: event.weaponId,
        armorId: event.armorId,
        accessoryId: event.accessoryId,
        synergyIds: [...event.synergyIds],
      };
    case "upgrade_choices_created":
      return {
        type: event.type,
        playerId: event.playerId,
        choices: [...event.choices],
      };
    case "upgrade_selected":
      return {
        type: event.type,
        playerId: event.playerId,
        upgradeId: event.upgradeId,
      };
    case "skill_used":
      return {
        type: event.type,
        playerId: event.playerId,
        skillId: event.skillId,
      };
    case "match_ended":
      return {
        type: event.type,
        result: {
          ...event.result,
          rewards: Object.fromEntries(
            Object.entries(event.result.rewards).map(([playerId, reward]) => [
              playerId,
              { ...reward },
            ]),
          ),
          unlocks: Object.fromEntries(
            Object.entries(event.result.unlocks).map(([playerId, unlockIds]) => [
              playerId,
              [...unlockIds],
            ]),
          ),
        },
      };
  }
}

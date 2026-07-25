import {
  actionId,
  enemyId,
  matchId,
  playerId,
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
      level: player.level,
      experience: player.experience,
      nextLevelExperience: player.nextLevelExperience,
      attackPower: player.attackPower,
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
    players,
    enemies,
    result: state.result === null ? null : { ...state.result },
  };
}

export function toStoredGameState(state: GameState): StoredGameState {
  const players: StoredGameState["players"] = {};
  for (const [id, player] of Object.entries(state.players)) {
    players[id] = {
      ...player,
      id: player.id,
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
    result: state.result === null ? null : { ...state.result },
  };
}

export function fromStoredGameState(stored: StoredGameState): GameState {
  const players: GameState["players"] = {};
  for (const [id, player] of Object.entries(stored.players)) {
    players[id] = {
      ...player,
      id: playerId(player.id),
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
    result: stored.result === null ? null : { ...stored.result },
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
    case "match_ended":
      return { type: event.type, result: { ...event.result } };
  }
}

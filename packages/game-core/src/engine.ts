import type {
  EnemyDefinition,
  GameContent,
  HeroClassId,
  SkillDefinition,
  UpgradeDefinition,
} from "./content.js";
import { enemyId, type ActionId, type MatchId, type PlayerId } from "./ids.js";
import { initialRandomState, nextRandom } from "./random.js";
import type {
  CommandResult,
  EnemyState,
  GameCommand,
  GameEvent,
  GameState,
  MatchResult,
  PlayerState,
  StepResult,
} from "./types.js";

const MAX_PROCESSED_ACTION_IDS = 512;
const MAX_PLAYERS = 4;
const LEVEL_BASE_EXPERIENCE = 30;

export interface CreateGameInput {
  readonly matchId: MatchId;
  readonly seed: string;
  readonly content: GameContent;
}

export function createGame(input: CreateGameInput): GameState {
  return {
    schemaVersion: 1,
    matchId: input.matchId,
    seed: input.seed,
    rulesetVersion: input.content.rulesetVersion,
    contentVersion: input.content.version,
    status: "lobby",
    tick: 0,
    elapsedMs: 0,
    randomState: initialRandomState(input.seed),
    waveIndex: 0,
    spawnSequence: 0,
    players: {},
    enemies: {},
    processedActionIds: [],
    result: null,
  };
}

export function applyCommand(
  sourceState: GameState,
  command: GameCommand,
  content: GameContent,
): CommandResult {
  if (sourceState.processedActionIds.includes(command.actionId)) {
    return { accepted: true, state: sourceState, events: [], errorCode: null };
  }

  const state = cloneState(sourceState);
  const events: GameEvent[] = [];
  const rejection = executeCommand(state, command, content, events);

  if (rejection !== null) {
    return { accepted: false, state: sourceState, events: [], errorCode: rejection };
  }

  rememberAction(state, command.actionId);
  return { accepted: true, state, events, errorCode: null };
}

export function stepGame(
  sourceState: GameState,
  elapsedMs: number,
  content: GameContent,
): StepResult {
  if (!Number.isInteger(elapsedMs) || elapsedMs <= 0) {
    throw new Error("elapsedMs must be a positive integer");
  }

  if (sourceState.status !== "running") {
    return { state: sourceState, events: [] };
  }

  const state = cloneState(sourceState);
  const events: GameEvent[] = [];
  state.tick += 1;
  state.elapsedMs += elapsedMs;

  updatePlayerCooldowns(state, elapsedMs);
  updateEnemyCooldowns(state, elapsedMs);
  runPlayerAutoAttacks(state, content, events);
  removeDefeatedEnemies(state, content, events);
  spawnWaveWhenNeeded(state, content, events);
  runEnemyAttacks(state, content, events);
  evaluateDefeat(state, events);

  return { state, events };
}

function executeCommand(
  state: GameState,
  command: GameCommand,
  content: GameContent,
  events: GameEvent[],
): string | null {
  switch (command.type) {
    case "join_player":
      return joinPlayer(
        state,
        command.playerId,
        command.displayName,
        command.classId,
        content,
        events,
      );
    case "set_ready":
      return setReady(state, command.playerId, command.ready);
    case "select_class":
      return selectClass(state, command.playerId, command.classId, content);
    case "start_match":
      return startMatch(state, command.playerId, content, events);
    case "cast_skill":
      return castSkill(state, command.playerId, command.skillId, content, events);
    case "select_upgrade":
      return selectUpgrade(state, command.playerId, command.upgradeId, content, events);
    case "disconnect_player":
      return disconnectPlayer(state, command.playerId, events);
    case "reconnect_player":
      return reconnectPlayer(state, command.playerId, command.displayName, events);
  }
}

function joinPlayer(
  state: GameState,
  id: PlayerId,
  displayName: string,
  classId: HeroClassId,
  content: GameContent,
  events: GameEvent[],
): string | null {
  const existing = state.players[id];
  if (existing !== undefined) {
    existing.connection = "connected";
    existing.displayName = displayName;
    events.push({ type: "player_reconnected", playerId: id });
    return null;
  }

  if (Object.keys(state.players).length >= MAX_PLAYERS) {
    return "room_full";
  }

  const definition = content.classes[classId];
  state.players[id] = createPlayer(id, displayName, definition.id, content);
  events.push({ type: "player_joined", playerId: id });
  return null;
}

function createPlayer(
  id: PlayerId,
  displayName: string,
  classId: HeroClassId,
  content: GameContent,
): PlayerState {
  const definition = content.classes[classId];
  const cooldowns: Record<string, number> = {};
  for (const skillId of definition.skillIds) {
    cooldowns[skillId] = 0;
  }

  return {
    id,
    displayName,
    classId,
    ready: false,
    connection: "connected",
    hp: definition.maxHp,
    maxHp: definition.maxHp,
    shield: 0,
    level: 1,
    experience: 0,
    nextLevelExperience: LEVEL_BASE_EXPERIENCE,
    attackPower: definition.attackPower,
    attackIntervalMs: definition.attackIntervalMs,
    attackCooldownMs: definition.attackIntervalMs,
    skillCooldownMultiplier: 1,
    healingMultiplier: 1,
    skillCooldowns: cooldowns,
    upgrades: [],
    pendingUpgradeChoices: [],
    score: 0,
    stats: {
      damageDealt: 0,
      healingDone: 0,
      damageTaken: 0,
      enemiesDefeated: 0,
    },
  };
}

function setReady(state: GameState, id: PlayerId, ready: boolean): string | null {
  if (state.status !== "lobby") {
    return "match_already_started";
  }
  const player = state.players[id];
  if (player === undefined) {
    return "player_not_found";
  }
  player.ready = ready;
  return null;
}

function selectClass(
  state: GameState,
  id: PlayerId,
  classId: HeroClassId,
  content: GameContent,
): string | null {
  if (state.status !== "lobby") {
    return "match_already_started";
  }
  const player = state.players[id];
  if (player === undefined) {
    return "player_not_found";
  }
  const replacement = createPlayer(id, player.displayName, classId, content);
  replacement.ready = player.ready;
  replacement.connection = player.connection;
  state.players[id] = replacement;
  return null;
}

function startMatch(
  state: GameState,
  id: PlayerId,
  content: GameContent,
  events: GameEvent[],
): string | null {
  if (state.status !== "lobby") {
    return "match_already_started";
  }
  if (state.players[id] === undefined) {
    return "player_not_found";
  }
  const players = Object.values(state.players);
  if (players.length === 0 || players.some((player) => !player.ready)) {
    return "players_not_ready";
  }

  state.status = "running";
  events.push({ type: "match_started" });
  spawnWave(state, content, events);
  return null;
}

function castSkill(
  state: GameState,
  id: PlayerId,
  skillId: string,
  content: GameContent,
  events: GameEvent[],
): string | null {
  if (state.status !== "running") {
    return "match_not_running";
  }
  const player = state.players[id];
  if (player === undefined || player.hp <= 0) {
    return "player_unavailable";
  }
  const skill = content.skills[skillId];
  if (skill?.classId !== player.classId) {
    return "skill_not_available";
  }
  const cooldown = player.skillCooldowns[skillId];
  if (cooldown === undefined || cooldown > 0) {
    return "skill_on_cooldown";
  }

  applySkillEffect(state, player, skill, events);
  player.skillCooldowns[skillId] = Math.ceil(skill.cooldownMs * player.skillCooldownMultiplier);
  removeDefeatedEnemies(state, content, events);
  spawnWaveWhenNeeded(state, content, events);
  return null;
}

function applySkillEffect(
  state: GameState,
  player: PlayerState,
  skill: SkillDefinition,
  events: GameEvent[],
): void {
  switch (skill.effect.type) {
    case "damage_single": {
      const enemy = firstLivingEnemy(state);
      if (enemy !== null) {
        dealDamageToEnemy(player, enemy, skill.effect.power, events);
      }
      return;
    }
    case "damage_all":
      for (const enemy of Object.values(state.enemies)) {
        if (enemy.hp > 0) {
          dealDamageToEnemy(player, enemy, skill.effect.power, events);
        }
      }
      return;
    case "heal_all":
      for (const target of Object.values(state.players)) {
        if (target.hp > 0) {
          const amount = Math.max(1, Math.round(skill.effect.power * player.healingMultiplier));
          const actual = Math.min(amount, target.maxHp - target.hp);
          target.hp += actual;
          player.stats.healingDone += actual;
          events.push({ type: "healing", sourcePlayerId: player.id, amount: actual });
        }
      }
      return;
    case "shield_all":
      for (const target of Object.values(state.players)) {
        if (target.hp > 0) {
          target.shield += skill.effect.power;
        }
      }
      return;
  }
}

function selectUpgrade(
  state: GameState,
  id: PlayerId,
  upgradeId: string,
  content: GameContent,
  events: GameEvent[],
): string | null {
  const player = state.players[id];
  if (player === undefined) {
    return "player_not_found";
  }
  if (!player.pendingUpgradeChoices.includes(upgradeId)) {
    return "upgrade_not_offered";
  }
  const upgrade = content.upgrades[upgradeId];
  if (upgrade === undefined) {
    return "upgrade_not_found";
  }

  applyUpgrade(player, upgrade);
  player.upgrades.push(upgrade.id);
  player.pendingUpgradeChoices = [];
  events.push({ type: "upgrade_selected", playerId: id, upgradeId });
  return null;
}

function applyUpgrade(player: PlayerState, upgrade: UpgradeDefinition): void {
  if (upgrade.attackMultiplier !== undefined) {
    player.attackPower = Math.max(1, Math.round(player.attackPower * upgrade.attackMultiplier));
  }
  if (upgrade.maxHpBonus !== undefined) {
    player.maxHp += upgrade.maxHpBonus;
    player.hp += upgrade.maxHpBonus;
  }
  if (upgrade.skillCooldownMultiplier !== undefined) {
    player.skillCooldownMultiplier *= upgrade.skillCooldownMultiplier;
  }
  if (upgrade.healingMultiplier !== undefined) {
    player.healingMultiplier *= upgrade.healingMultiplier;
  }
}

function disconnectPlayer(state: GameState, id: PlayerId, events: GameEvent[]): string | null {
  const player = state.players[id];
  if (player === undefined) {
    return "player_not_found";
  }
  player.connection = "ai_controlled";
  events.push({ type: "player_disconnected", playerId: id });
  return null;
}

function reconnectPlayer(
  state: GameState,
  id: PlayerId,
  displayName: string,
  events: GameEvent[],
): string | null {
  const player = state.players[id];
  if (player === undefined) {
    return "player_not_found";
  }
  player.connection = "connected";
  player.displayName = displayName;
  events.push({ type: "player_reconnected", playerId: id });
  return null;
}

function updatePlayerCooldowns(state: GameState, elapsedMs: number): void {
  for (const player of Object.values(state.players)) {
    player.attackCooldownMs = Math.max(0, player.attackCooldownMs - elapsedMs);
    for (const skillId of Object.keys(player.skillCooldowns)) {
      const current = player.skillCooldowns[skillId];
      if (current !== undefined) {
        player.skillCooldowns[skillId] = Math.max(0, current - elapsedMs);
      }
    }
  }
}

function updateEnemyCooldowns(state: GameState, elapsedMs: number): void {
  for (const enemy of Object.values(state.enemies)) {
    enemy.attackCooldownMs = Math.max(0, enemy.attackCooldownMs - elapsedMs);
  }
}

function runPlayerAutoAttacks(state: GameState, content: GameContent, events: GameEvent[]): void {
  for (const player of Object.values(state.players)) {
    if (player.hp <= 0 || player.pendingUpgradeChoices.length > 0) {
      continue;
    }
    if (player.attackCooldownMs > 0) {
      continue;
    }
    const target = firstLivingEnemy(state);
    if (target === null) {
      continue;
    }
    dealDamageToEnemy(player, target, player.attackPower, events);
    player.attackCooldownMs = player.attackIntervalMs;
  }
  removeDefeatedEnemies(state, content, events);
}

function dealDamageToEnemy(
  player: PlayerState,
  enemy: EnemyState,
  amount: number,
  events: GameEvent[],
): void {
  const actual = Math.max(0, Math.min(amount, enemy.hp));
  enemy.hp -= actual;
  player.stats.damageDealt += actual;
  player.score += actual;
  events.push({
    type: "damage",
    sourcePlayerId: player.id,
    enemyId: enemy.id,
    targetPlayerId: null,
    amount: actual,
  });
}

function runEnemyAttacks(state: GameState, content: GameContent, events: GameEvent[]): void {
  const targets = Object.values(state.players).filter((player) => player.hp > 0);
  if (targets.length === 0) {
    return;
  }

  for (const enemy of Object.values(state.enemies)) {
    if (enemy.hp <= 0 || enemy.attackCooldownMs > 0) {
      continue;
    }
    const random = nextRandom(state.randomState);
    state.randomState = random.state;
    const targetIndex = Math.min(targets.length - 1, Math.floor(random.value * targets.length));
    const target = targets[targetIndex];
    if (target === undefined) {
      continue;
    }
    dealDamageToPlayer(enemy, target, enemy.attackPower, events);
    const definition = content.enemies[enemy.definitionId];
    enemy.attackCooldownMs = definition?.attackIntervalMs ?? enemy.attackIntervalMs;
  }
}

function dealDamageToPlayer(
  enemy: EnemyState,
  player: PlayerState,
  amount: number,
  events: GameEvent[],
): void {
  const absorbed = Math.min(player.shield, amount);
  player.shield -= absorbed;
  const remaining = amount - absorbed;
  const actual = Math.max(0, Math.min(remaining, player.hp));
  player.hp -= actual;
  player.stats.damageTaken += actual;
  events.push({
    type: "damage",
    sourcePlayerId: null,
    enemyId: enemy.id,
    targetPlayerId: player.id,
    amount: actual,
  });
}

function removeDefeatedEnemies(state: GameState, content: GameContent, events: GameEvent[]): void {
  for (const enemy of Object.values(state.enemies)) {
    if (enemy.hp > 0) {
      continue;
    }
    const definition = content.enemies[enemy.definitionId];
    if (definition !== undefined) {
      grantEnemyRewards(state, definition, content, events);
    }
    Reflect.deleteProperty(state.enemies, enemy.id);
    events.push({ type: "enemy_defeated", enemyId: enemy.id });
  }
}

function grantEnemyRewards(
  state: GameState,
  enemy: EnemyDefinition,
  content: GameContent,
  events: GameEvent[],
): void {
  const players = Object.values(state.players).filter((player) => player.hp > 0);
  for (const player of players) {
    player.experience += enemy.experience;
    player.score += enemy.score;
    player.stats.enemiesDefeated += 1;
    createUpgradeChoiceWhenEligible(state, player, content, events);
  }
}

function createUpgradeChoiceWhenEligible(
  state: GameState,
  player: PlayerState,
  content: GameContent,
  events: GameEvent[],
): void {
  if (player.experience < player.nextLevelExperience || player.pendingUpgradeChoices.length > 0) {
    return;
  }

  player.experience -= player.nextLevelExperience;
  player.level += 1;
  player.nextLevelExperience = LEVEL_BASE_EXPERIENCE + player.level * 15;
  const upgradeIds = Object.keys(content.upgrades).filter(
    (upgradeId) => !player.upgrades.includes(upgradeId),
  );
  const choices: string[] = [];
  const pool = [...upgradeIds];

  while (choices.length < 3 && pool.length > 0) {
    const random = nextRandom(state.randomState);
    state.randomState = random.state;
    const index = Math.min(pool.length - 1, Math.floor(random.value * pool.length));
    const selected = pool.splice(index, 1)[0];
    if (selected !== undefined) {
      choices.push(selected);
    }
  }

  player.pendingUpgradeChoices = choices;
  events.push({ type: "upgrade_choices_created", playerId: player.id, choices });
}

function spawnWaveWhenNeeded(state: GameState, content: GameContent, events: GameEvent[]): void {
  if (Object.keys(state.enemies).length > 0 || state.status !== "running") {
    return;
  }
  if (state.waveIndex >= content.stage.waves.length) {
    endMatch(state, "victory", events);
    return;
  }
  spawnWave(state, content, events);
}

function spawnWave(state: GameState, content: GameContent, events: GameEvent[]): void {
  const wave = content.stage.waves[state.waveIndex];
  if (wave === undefined) {
    endMatch(state, "victory", events);
    return;
  }
  const currentWaveIndex = state.waveIndex;
  state.waveIndex += 1;

  for (const definitionId of wave.enemyDefinitionIds) {
    const definition = content.enemies[definitionId];
    if (definition === undefined) {
      throw new Error(`Enemy definition not found: ${definitionId}`);
    }
    const id = enemyId(`enemy-${state.spawnSequence}`);
    state.spawnSequence += 1;
    state.enemies[id] = {
      id,
      definitionId,
      hp: definition.maxHp,
      maxHp: definition.maxHp,
      attackPower: definition.attackPower,
      attackIntervalMs: definition.attackIntervalMs,
      attackCooldownMs: definition.attackIntervalMs,
      boss: definition.boss,
    };
  }
  events.push({ type: "wave_spawned", waveIndex: currentWaveIndex });
}

function evaluateDefeat(state: GameState, events: GameEvent[]): void {
  const players = Object.values(state.players);
  if (players.length > 0 && players.every((player) => player.hp <= 0)) {
    endMatch(state, "defeat", events);
  }
}

function endMatch(state: GameState, outcome: MatchResult["outcome"], events: GameEvent[]): void {
  if (state.result !== null) {
    return;
  }
  state.status = outcome;
  state.result = {
    outcome,
    durationMs: state.elapsedMs,
    completedAtTick: state.tick,
  };
  events.push({ type: "match_ended", result: state.result });
}

function firstLivingEnemy(state: GameState): EnemyState | null {
  for (const enemy of Object.values(state.enemies)) {
    if (enemy.hp > 0) {
      return enemy;
    }
  }
  return null;
}

function rememberAction(state: GameState, id: ActionId): void {
  state.processedActionIds.push(id);
  if (state.processedActionIds.length > MAX_PROCESSED_ACTION_IDS) {
    state.processedActionIds.splice(0, state.processedActionIds.length - MAX_PROCESSED_ACTION_IDS);
  }
}

export function cloneState(source: GameState): GameState {
  const players: Record<string, PlayerState> = {};
  for (const [id, player] of Object.entries(source.players)) {
    players[id] = {
      ...player,
      skillCooldowns: { ...player.skillCooldowns },
      upgrades: [...player.upgrades],
      pendingUpgradeChoices: [...player.pendingUpgradeChoices],
      stats: { ...player.stats },
    };
  }

  const enemies: Record<string, EnemyState> = {};
  for (const [id, enemy] of Object.entries(source.enemies)) {
    enemies[id] = { ...enemy };
  }

  return {
    ...source,
    players,
    enemies,
    processedActionIds: [...source.processedActionIds],
    result: source.result === null ? null : { ...source.result },
  };
}

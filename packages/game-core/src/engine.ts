import type {
  EnemyDefinition,
  EquipmentEffect,
  ExpeditionChoiceDefinition,
  GameContent,
  HeroClassId,
  SkillDefinition,
  UpgradeDefinition,
} from "./content.js";
import { enemyId, type ActionId, type MatchId, type PlayerId } from "./ids.js";
import { initialRandomState, nextRandom } from "./random.js";
import type {
  ActiveDecision,
  CommandResult,
  DecisionChoicePreview,
  EnemyState,
  GameCommand,
  GameEvent,
  GameState,
  MatchResult,
  MatchReward,
  AutomationPolicy,
  DecisionSummary,
  ProgressPolicy,
  PlayerState,
  PlayerLoadout,
  PlayerProfile,
  RescuePolicy,
  RetreatPolicy,
  StepResult,
} from "./types.js";

const MAX_PROCESSED_ACTION_IDS = 512;
const MAX_PLAYERS = 4;
const LEVEL_BASE_EXPERIENCE = 30;
const DECISION_WINDOW_MS = 4_000;
const RESCUE_WINDOW_MS = 10_000;
const RESCUE_DURATION_MS = 1_500;
const RESCUE_COOLDOWN_MS = 4_000;
const RESCUE_REVIVAL_HP_PERCENT = 35;

export const DEFAULT_AUTOMATION_POLICY: AutomationPolicy = {
  growth: "adaptive",
  progress: "balanced",
  retreat: "standard",
  rescue: "standard",
};

export const RESCUE_WINDOW_DURATION_MS = RESCUE_WINDOW_MS;
export const RESCUE_ACTION_DURATION_MS = RESCUE_DURATION_MS;

export function getRescueWindowDurationMs(
  player: Pick<PlayerState, "rescueDurationMultiplier">,
): number {
  return Math.max(1_000, Math.round(RESCUE_WINDOW_MS * player.rescueDurationMultiplier));
}

export function getRescueActionDurationMs(
  player: Pick<PlayerState, "rescueDurationMultiplier">,
): number {
  return Math.max(250, Math.round(RESCUE_DURATION_MS * player.rescueDurationMultiplier));
}

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
    decisionIndex: 0,
    activeDecision: null,
    lastDecision: null,
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

  if (state.activeDecision !== null) {
    if (!resolveActiveDecisionWhenReady(state, content, events)) {
      return { state, events };
    }
    if (!spawnWaveWhenNeeded(state, content, events, false)) {
      return { state, events };
    }
  }

  updatePlayerCooldowns(state, elapsedMs);
  updateRescueCooldowns(state, elapsedMs);
  assignAutomaticRescues(state, events);
  progressRescues(state, elapsedMs, events);
  evaluateDefeat(state, content, events);
  if (state.status !== "running") {
    return { state, events };
  }
  updateEnemyCooldowns(state, elapsedMs);
  resolveLegacyUpgradeChoices(state, content, events);
  runPlayerAutoSkills(state, content, events);
  runPlayerAutoAttacks(state, content, events);
  removeDefeatedEnemies(state, content, events);
  spawnWaveWhenNeeded(state, content, events);
  runEnemyAttacks(state, content, events);
  evaluateDefeat(state, content, events);

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
        command.profile,
        events,
      );
    case "set_ready":
      return setReady(state, command.playerId, command.ready);
    case "select_class":
      return selectClass(state, command.playerId, command.classId, content);
    case "set_automation_policy":
      return setAutomationPolicy(state, command.playerId, command.policy);
    case "set_loadout":
      return setLoadout(state, command.playerId, command.activeSkillIds, content);
    case "set_equipment":
      return setEquipment(
        state,
        command.playerId,
        command.weaponId,
        command.armorId,
        command.accessoryId,
        content,
        events,
      );
    case "start_match":
      return startMatch(state, command.playerId, content, events);
    case "restart_match":
      return restartMatch(state, command.playerId, command.matchId, command.seed, content, events);
    case "return_to_lobby":
      return returnToLobby(state, command.playerId, command.matchId, command.seed, content);
    case "cast_skill":
      return castSkill(state, command.playerId, command.skillId, content, events);
    case "select_upgrade":
      return selectUpgrade(state, command.playerId, command.upgradeId, content, events);
    case "override_decision":
      return overrideDecision(
        state,
        command.playerId,
        command.decisionId,
        command.choiceId,
        content,
        events,
      );
    case "rescue_player":
      return requestRescue(state, command.playerId, command.targetPlayerId, events);
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
  profile: PlayerProfile | undefined,
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

  if (state.status !== "lobby" && state.status !== "running") {
    return "match_already_started";
  }

  const definition = content.classes[classId];
  const player = createPlayer(id, displayName, definition.id, content, profile);
  state.players[id] = player;
  events.push({ type: "player_joined", playerId: id });
  if (state.status === "running") {
    seedLateJoinProgression(state, player, content, events);
  }
  return null;
}

function createPlayer(
  id: PlayerId,
  displayName: string,
  classId: HeroClassId,
  content: GameContent,
  profile?: PlayerProfile,
): PlayerState {
  const definition = content.classes[classId];
  const cooldowns: Record<string, number> = {};
  for (const skillId of definition.skillIds) {
    cooldowns[skillId] = 0;
  }

  const player: PlayerState = {
    id,
    displayName,
    classId,
    ready: false,
    connection: "connected",
    hp: definition.maxHp,
    maxHp: definition.maxHp,
    shield: 0,
    downed: false,
    eliminated: false,
    downedAtMs: null,
    rescueDeadlineMs: null,
    rescueTargetId: null,
    rescueProgressMs: 0,
    rescueCooldownMs: 0,
    rescueDurationMultiplier: 1,
    waveShieldBonus: 0,
    activeSynergyIds: [],
    unlockedContentIds:
      profile === undefined
        ? []
        : [
            ...new Set(
              profile.unlockedContentIds.filter((contentId) =>
                Object.values(content.unlocks).some((unlock) => unlock.contentId === contentId),
              ),
            ),
          ],
    level: 1,
    experience: 0,
    nextLevelExperience: LEVEL_BASE_EXPERIENCE,
    attackPower: definition.attackPower,
    attackIntervalMs: definition.attackIntervalMs,
    attackCooldownMs: definition.attackIntervalMs,
    loadout: createStarterLoadout(classId, content),
    automation: { ...DEFAULT_AUTOMATION_POLICY },
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
  applyPlayerProfile(player, profile, content);
  rebuildEquipmentStats(player, content);
  return player;
}

function applyPlayerProfile(
  player: PlayerState,
  profile: PlayerProfile | undefined,
  content: GameContent,
): void {
  if (profile === undefined) {
    return;
  }
  if (profile.automation !== null) {
    player.automation = { ...profile.automation };
  }
  if (profile.loadout === null) {
    return;
  }

  const loadout = profile.loadout;
  const nextLoadout = { ...player.loadout };
  if (validateLoadout(player.classId, loadout.activeSkillIds, content) === null) {
    nextLoadout.activeSkillIds = [...loadout.activeSkillIds];
  }
  if (
    validateEquipment(
      player.classId,
      loadout.weaponId,
      loadout.armorId,
      loadout.accessoryId,
      content,
    ) === null
  ) {
    nextLoadout.weaponId = loadout.weaponId;
    nextLoadout.armorId = loadout.armorId;
    nextLoadout.accessoryId = loadout.accessoryId;
  }
  player.loadout = nextLoadout;
}

function seedLateJoinProgression(
  state: GameState,
  player: PlayerState,
  content: GameContent,
  events: GameEvent[],
): void {
  const existingLevels = Object.values(state.players)
    .filter((candidate) => candidate.id !== player.id)
    .map((candidate) => candidate.level);
  if (existingLevels.length === 0) {
    return;
  }

  const averageLevel =
    existingLevels.reduce((total, level) => total + level, 0) / existingLevels.length;
  const startingLevel = Math.max(1, Math.round(averageLevel));
  while (player.level < startingLevel) {
    player.level += 1;
    player.nextLevelExperience = LEVEL_BASE_EXPERIENCE + player.level * 15;
    const upgrade = selectAutomaticUpgrade(state, player, content);
    if (upgrade === null) {
      continue;
    }
    applyUpgrade(player, upgrade);
    player.upgrades.push(upgrade.id);
    events.push({ type: "upgrade_selected", playerId: player.id, upgradeId: upgrade.id });
  }
  player.experience = 0;
  player.hp = player.maxHp;
  player.shield = 0;
}

function createStarterLoadout(classId: HeroClassId, content: GameContent): PlayerLoadout {
  const loadout: PlayerLoadout = {
    activeSkillIds: [...content.classes[classId].skillIds],
    weaponId: null,
    armorId: null,
    accessoryId: null,
  };
  for (const equipmentId of content.classes[classId].equipmentIds) {
    const equipment = content.equipment[equipmentId];
    if (equipment === undefined) {
      continue;
    }
    if (equipment.slot === "weapon" && loadout.weaponId === null) {
      loadout.weaponId = equipment.id;
    } else if (equipment.slot === "armor" && loadout.armorId === null) {
      loadout.armorId = equipment.id;
    } else if (equipment.slot === "accessory" && loadout.accessoryId === null) {
      loadout.accessoryId = equipment.id;
    }
  }
  return loadout;
}

function rebuildEquipmentStats(player: PlayerState, content: GameContent): void {
  const classDefinition = content.classes[player.classId];
  player.attackPower = classDefinition.attackPower;
  player.maxHp = classDefinition.maxHp;
  player.attackIntervalMs = classDefinition.attackIntervalMs;
  player.skillCooldownMultiplier = 1;
  player.healingMultiplier = 1;
  player.rescueDurationMultiplier = 1;
  player.waveShieldBonus = 0;
  player.activeSynergyIds = [];

  const selectedEquipmentIds = getSelectedEquipmentIds(player.loadout);
  const equipmentTags = new Set<string>();
  for (const equipmentId of selectedEquipmentIds) {
    const equipment = content.equipment[equipmentId];
    if (equipment === undefined) {
      continue;
    }
    for (const tag of equipment.tags) {
      equipmentTags.add(tag);
    }
    applyEquipmentEffects(player, equipment.effects);
  }

  const activeSkillIds =
    player.loadout.activeSkillIds.length > 0
      ? player.loadout.activeSkillIds
      : classDefinition.skillIds;
  const synergies = Object.values(content.equipmentSynergies).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  for (const synergy of synergies) {
    const hasEquipmentTags = synergy.requiredEquipmentTags.every((tag) => equipmentTags.has(tag));
    const hasSkills = synergy.requiredSkillIds.every((skillId) => activeSkillIds.includes(skillId));
    if (!hasEquipmentTags || !hasSkills) {
      continue;
    }
    player.activeSynergyIds.push(synergy.id);
    applyEquipmentEffects(player, synergy.effects);
  }

  player.attackPower = Math.max(1, Math.round(player.attackPower));
  player.maxHp = Math.max(1, Math.round(player.maxHp));
  player.attackIntervalMs = Math.max(100, Math.round(player.attackIntervalMs));
  player.skillCooldownMultiplier = Math.max(0.1, player.skillCooldownMultiplier);
  player.healingMultiplier = Math.max(0.1, player.healingMultiplier);
  player.rescueDurationMultiplier = Math.max(0.25, player.rescueDurationMultiplier);
  player.hp = player.maxHp;
  player.shield = 0;
  player.attackCooldownMs = player.attackIntervalMs;
}

function getSelectedEquipmentIds(loadout: PlayerLoadout): readonly string[] {
  return [loadout.weaponId, loadout.armorId, loadout.accessoryId].filter(
    (equipmentId): equipmentId is string => equipmentId !== null,
  );
}

function applyEquipmentEffects(player: PlayerState, effects: readonly EquipmentEffect[]): void {
  for (const effect of effects) {
    switch (effect.type) {
      case "attack_power_bonus":
        player.attackPower += effect.amount;
        break;
      case "max_hp_bonus":
        player.maxHp += effect.amount;
        break;
      case "attack_interval_multiplier":
        player.attackIntervalMs *= effect.multiplier;
        break;
      case "skill_cooldown_multiplier":
        player.skillCooldownMultiplier *= effect.multiplier;
        break;
      case "healing_multiplier":
        player.healingMultiplier *= effect.multiplier;
        break;
      case "rescue_duration_multiplier":
        player.rescueDurationMultiplier *= effect.multiplier;
        break;
      case "shield_on_wave":
        player.waveShieldBonus += effect.amount;
        break;
    }
  }
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
  replacement.automation = { ...player.automation };
  state.players[id] = replacement;
  return null;
}

function setAutomationPolicy(
  state: GameState,
  id: PlayerId,
  policy: AutomationPolicy,
): string | null {
  if (state.status !== "lobby") {
    return "match_already_started";
  }
  const player = state.players[id];
  if (player === undefined) {
    return "player_not_found";
  }
  player.automation = { ...policy };
  return null;
}

function setLoadout(
  state: GameState,
  id: PlayerId,
  activeSkillIds: readonly string[],
  content: GameContent,
): string | null {
  if (state.status !== "lobby") {
    return "match_already_started";
  }
  const player = state.players[id];
  if (player === undefined) {
    return "player_not_found";
  }
  const rejection = validateLoadout(player.classId, activeSkillIds, content);
  if (rejection !== null) {
    return rejection;
  }
  player.loadout = {
    ...player.loadout,
    activeSkillIds: [...activeSkillIds],
  };
  rebuildEquipmentStats(player, content);
  return null;
}

function setEquipment(
  state: GameState,
  id: PlayerId,
  weaponId: string | null,
  armorId: string | null,
  accessoryId: string | null,
  content: GameContent,
  events: GameEvent[],
): string | null {
  if (state.status !== "lobby") {
    return "match_already_started";
  }
  const player = state.players[id];
  if (player === undefined) {
    return "player_not_found";
  }

  const rejection = validateEquipment(player.classId, weaponId, armorId, accessoryId, content);
  if (rejection !== null) {
    return rejection;
  }

  player.loadout = {
    ...player.loadout,
    weaponId,
    armorId,
    accessoryId,
  };
  rebuildEquipmentStats(player, content);
  events.push({
    type: "equipment_changed",
    playerId: player.id,
    weaponId,
    armorId,
    accessoryId,
    synergyIds: [...player.activeSynergyIds],
  });
  return null;
}

function validateLoadout(
  classId: HeroClassId,
  activeSkillIds: readonly string[],
  content: GameContent,
): string | null {
  if (activeSkillIds.length === 0 || activeSkillIds.length > 2) {
    return "loadout_invalid";
  }
  const uniqueSkillIds = new Set(activeSkillIds);
  if (uniqueSkillIds.size !== activeSkillIds.length) {
    return "loadout_invalid";
  }
  const classSkillIds = content.classes[classId].skillIds;
  return activeSkillIds.some((skillId) => !classSkillIds.includes(skillId))
    ? "skill_not_available"
    : null;
}

function validateEquipment(
  classId: HeroClassId,
  weaponId: string | null,
  armorId: string | null,
  accessoryId: string | null,
  content: GameContent,
): string | null {
  const selections = [
    { id: weaponId, slot: "weapon" as const },
    { id: armorId, slot: "armor" as const },
    { id: accessoryId, slot: "accessory" as const },
  ];
  const selectedIds = new Set<string>();
  for (const selection of selections) {
    if (selection.id === null) {
      continue;
    }
    if (selectedIds.has(selection.id)) {
      return "equipment_invalid";
    }
    selectedIds.add(selection.id);
    const equipment = content.equipment[selection.id];
    if (equipment === undefined) {
      return "equipment_not_found";
    }
    if (!content.classes[classId].equipmentIds.includes(selection.id)) {
      return "equipment_not_available";
    }
    if (equipment.slot !== selection.slot) {
      return "equipment_slot_mismatch";
    }
  }
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
  spawnWaveWhenNeeded(state, content, events);
  return null;
}

function restartMatch(
  state: GameState,
  id: PlayerId,
  nextMatchId: MatchId,
  seed: string,
  content: GameContent,
  events: GameEvent[],
): string | null {
  if (state.status !== "victory" && state.status !== "defeat" && state.status !== "return") {
    return "match_not_finished";
  }
  if (state.players[id] === undefined) {
    return "player_not_found";
  }

  resetMatchState(state, nextMatchId, seed, content, true);

  const players = Object.values(state.players);
  if (players.length === 0 || players.some((player) => !player.ready)) {
    return null;
  }
  state.status = "running";
  events.push({ type: "match_started" });
  spawnWaveWhenNeeded(state, content, events);
  return null;
}

function returnToLobby(
  state: GameState,
  id: PlayerId,
  nextMatchId: MatchId,
  seed: string,
  content: GameContent,
): string | null {
  if (state.status !== "victory" && state.status !== "defeat" && state.status !== "return") {
    return "match_not_finished";
  }
  if (state.players[id] === undefined) {
    return "player_not_found";
  }
  resetMatchState(state, nextMatchId, seed, content, false);
  return null;
}

function resetMatchState(
  state: GameState,
  nextMatchId: MatchId,
  seed: string,
  content: GameContent,
  preserveReady: boolean,
): void {
  const restarted = createGame({ matchId: nextMatchId, seed, content });
  for (const player of Object.values(state.players)) {
    const replacement = createPlayer(player.id, player.displayName, player.classId, content);
    replacement.ready = preserveReady && player.ready;
    replacement.connection = player.connection;
    replacement.loadout = {
      activeSkillIds: [...player.loadout.activeSkillIds],
      weaponId: player.loadout.weaponId,
      armorId: player.loadout.armorId,
      accessoryId: player.loadout.accessoryId,
    };
    replacement.automation = { ...player.automation };
    rebuildEquipmentStats(replacement, content);
    restarted.players[player.id] = replacement;
  }
  Object.assign(state, restarted);
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
  if (player === undefined || !isPlayerActive(player)) {
    return "player_unavailable";
  }
  if (player.rescueTargetId !== null) {
    return "rescue_in_progress";
  }
  const skill = content.skills[skillId];
  if (skill?.classId !== player.classId) {
    return "skill_not_available";
  }
  const equippedSkillIds =
    player.loadout.activeSkillIds.length > 0
      ? player.loadout.activeSkillIds
      : content.classes[player.classId].skillIds;
  if (!equippedSkillIds.includes(skillId)) {
    return "skill_not_equipped";
  }
  const cooldown = player.skillCooldowns[skillId];
  if (cooldown === undefined || cooldown > 0) {
    return "skill_on_cooldown";
  }

  applySkillEffect(state, player, skill, events);
  events.push({ type: "skill_used", playerId: player.id, skillId: skill.id });
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
        if (isPlayerActive(target)) {
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
        if (isPlayerActive(target)) {
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

function runPlayerAutoSkills(state: GameState, content: GameContent, events: GameEvent[]): void {
  for (const player of Object.values(state.players)) {
    if (!isPlayerActive(player) || player.rescueTargetId !== null) {
      continue;
    }
    const skill = selectAutomaticSkill(state, player, content);
    if (skill === null) {
      continue;
    }
    applySkillEffect(state, player, skill, events);
    events.push({ type: "skill_used", playerId: player.id, skillId: skill.id });
    player.skillCooldowns[skill.id] = Math.ceil(skill.cooldownMs * player.skillCooldownMultiplier);
  }
}

function resolveLegacyUpgradeChoices(
  state: GameState,
  content: GameContent,
  events: GameEvent[],
): void {
  for (const player of Object.values(state.players)) {
    const upgradeId = player.pendingUpgradeChoices[0];
    if (upgradeId === undefined) {
      continue;
    }
    const upgrade = content.upgrades[upgradeId];
    player.pendingUpgradeChoices = [];
    if (upgrade === undefined) {
      continue;
    }
    applyUpgrade(player, upgrade);
    if (!player.upgrades.includes(upgrade.id)) {
      player.upgrades.push(upgrade.id);
    }
    events.push({ type: "upgrade_selected", playerId: player.id, upgradeId: upgrade.id });
  }
}

function selectAutomaticSkill(
  state: GameState,
  player: PlayerState,
  content: GameContent,
): SkillDefinition | null {
  const selectedSkillIds =
    player.loadout.activeSkillIds.length > 0
      ? player.loadout.activeSkillIds
      : content.classes[player.classId].skillIds;
  const available = selectedSkillIds
    .map((skillId) => content.skills[skillId])
    .filter((skill): skill is SkillDefinition => skill !== undefined)
    .filter((skill) => (player.skillCooldowns[skill.id] ?? 0) <= 0);
  if (available.length === 0) {
    return null;
  }

  const injuredPlayers = Object.values(state.players).filter(
    (target) => isPlayerActive(target) && target.hp < target.maxHp,
  );
  const livingEnemies = Object.values(state.enemies).filter((enemy) => enemy.hp > 0);
  const hasMissingShield = Object.values(state.players).some(
    (target) => isPlayerActive(target) && target.shield === 0,
  );

  for (const skill of available) {
    if (skill.effect.type === "heal_all" && injuredPlayers.length > 0) {
      return skill;
    }
    if (skill.effect.type === "shield_all" && hasMissingShield) {
      return skill;
    }
    if (skill.effect.type === "damage_all" && livingEnemies.length > 1) {
      return skill;
    }
  }

  return available[0] ?? null;
}

function runPlayerAutoAttacks(state: GameState, content: GameContent, events: GameEvent[]): void {
  for (const player of Object.values(state.players)) {
    if (
      !isPlayerActive(player) ||
      player.rescueTargetId !== null ||
      player.pendingUpgradeChoices.length > 0
    ) {
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
  const targets = Object.values(state.players).filter((player) => isPlayerActive(player));
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
    dealDamageToPlayer(state, enemy, target, enemy.attackPower, events);
    const definition = content.enemies[enemy.definitionId];
    enemy.attackCooldownMs = definition?.attackIntervalMs ?? enemy.attackIntervalMs;
  }
}

function dealDamageToPlayer(
  state: GameState,
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
  if (player.hp === 0 && !player.downed && !player.eliminated) {
    markPlayerDowned(state, player, events);
  }
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
  const players = Object.values(state.players).filter((player) => isPlayerActive(player));
  for (const player of players) {
    player.experience += enemy.experience;
    player.score += enemy.score;
    player.stats.enemiesDefeated += 1;
    applyAutomaticUpgradeWhenEligible(state, player, content, events);
  }
}

function applyAutomaticUpgradeWhenEligible(
  state: GameState,
  player: PlayerState,
  content: GameContent,
  events: GameEvent[],
): void {
  while (player.experience >= player.nextLevelExperience) {
    player.experience -= player.nextLevelExperience;
    player.level += 1;
    player.nextLevelExperience = LEVEL_BASE_EXPERIENCE + player.level * 15;

    const upgrade = selectAutomaticUpgrade(state, player, content);
    if (upgrade === null) {
      continue;
    }
    applyUpgrade(player, upgrade);
    player.upgrades.push(upgrade.id);
    events.push({ type: "upgrade_selected", playerId: player.id, upgradeId: upgrade.id });
  }
}

function selectAutomaticUpgrade(
  state: GameState,
  player: PlayerState,
  content: GameContent,
): UpgradeDefinition | null {
  const candidates = Object.values(content.upgrades).filter(
    (upgrade) => !player.upgrades.includes(upgrade.id),
  );
  if (candidates.length === 0) {
    return null;
  }

  const scored = candidates.map((upgrade) => ({
    upgrade,
    score: upgradeScore(player.automation.growth, upgrade),
  }));
  const highestScore = Math.max(...scored.map((entry) => entry.score));
  const tied = scored.filter((entry) => entry.score === highestScore);
  const random = nextRandom(state.randomState);
  state.randomState = random.state;
  const selected = tied[Math.min(tied.length - 1, Math.floor(random.value * tied.length))];
  return selected?.upgrade ?? null;
}

function upgradeScore(
  policy: PlayerState["automation"]["growth"],
  upgrade: UpgradeDefinition,
): number {
  switch (policy) {
    case "adaptive":
      return 10;
    case "offense":
      return upgrade.attackMultiplier !== undefined
        ? 40
        : upgrade.skillCooldownMultiplier !== undefined
          ? 30
          : 10;
    case "survival":
      return upgrade.maxHpBonus !== undefined
        ? 40
        : upgrade.healingMultiplier !== undefined
          ? 30
          : 10;
    case "skill":
      return upgrade.skillCooldownMultiplier !== undefined
        ? 40
        : upgrade.attackMultiplier !== undefined
          ? 30
          : 10;
    case "support":
      return upgrade.healingMultiplier !== undefined
        ? 40
        : upgrade.maxHpBonus !== undefined
          ? 30
          : 10;
  }
}

function spawnWaveWhenNeeded(
  state: GameState,
  content: GameContent,
  events: GameEvent[],
  allowDecision = true,
): boolean {
  if (Object.keys(state.enemies).length > 0 || state.status !== "running") {
    return false;
  }
  if (state.activeDecision !== null && !resolveActiveDecisionWhenReady(state, content, events)) {
    return false;
  }
  const players = Object.values(state.players);
  if (players.length > 0 && players.every((player) => !isPlayerActive(player))) {
    endMatch(state, "defeat", content, events);
    return false;
  }
  if (state.waveIndex >= content.stage.waves.length) {
    endMatch(state, "victory", content, events);
    return false;
  }
  if (shouldAutoRetreat(state, content, events)) {
    return false;
  }
  if (allowDecision && openNextDecision(state, content, events)) {
    return false;
  }
  spawnWave(state, content, events);
  return true;
}

function openNextDecision(state: GameState, content: GameContent, events: GameEvent[]): boolean {
  const decision = content.stage.decisions?.[state.decisionIndex];
  if (decision === undefined || decision.choices.length === 0) {
    return false;
  }
  const votes: Record<string, string> = {};
  for (const player of Object.values(state.players)) {
    const vote = choosePlayerDecision(player.automation.progress, decision.choices);
    votes[player.id] = vote.id;
  }

  const activeDecision: ActiveDecision = {
    kind: decision.kind,
    decisionId: decision.id,
    choices: decision.choices.map(toDecisionChoicePreview),
    openedAtMs: state.elapsedMs,
    deadlineMs: state.elapsedMs + DECISION_WINDOW_MS,
    votes,
    overriddenPlayerIds: [],
  };
  state.activeDecision = activeDecision;
  events.push({ type: "decision_opened", decision: cloneActiveDecision(activeDecision) });
  return true;
}

function resolveActiveDecisionWhenReady(
  state: GameState,
  content: GameContent,
  events: GameEvent[],
): boolean {
  const activeDecision = state.activeDecision;
  if (activeDecision === null) {
    return false;
  }
  const players = Object.values(state.players);
  const everyoneOverrode =
    players.length > 0 &&
    players.every((player) => activeDecision.overriddenPlayerIds.includes(player.id));
  if (state.elapsedMs < activeDecision.deadlineMs && !everyoneOverrode) {
    return false;
  }

  const decision = content.stage.decisions?.find(
    (candidate) => candidate.id === activeDecision.decisionId,
  );
  if (decision === undefined || decision.choices.length === 0) {
    state.activeDecision = null;
    return true;
  }

  const votesByChoice: Record<string, number> = {};
  for (const choice of decision.choices) {
    votesByChoice[choice.id] = 0;
  }
  for (const player of players) {
    const automaticChoice = choosePlayerDecision(player.automation.progress, decision.choices);
    const requestedChoiceId = activeDecision.votes[player.id] ?? automaticChoice.id;
    const selectedVote = decision.choices.find((choice) => choice.id === requestedChoiceId);
    const vote = selectedVote ?? automaticChoice;
    votesByChoice[vote.id] = (votesByChoice[vote.id] ?? 0) + 1;
  }

  const highestVoteCount = Math.max(...Object.values(votesByChoice));
  const tiedChoices = decision.choices.filter(
    (choice) => votesByChoice[choice.id] === highestVoteCount,
  );
  const selectedChoice = chooseWinningDecision(tiedChoices);
  const summary: DecisionSummary = {
    kind: decision.kind,
    decisionId: decision.id,
    choiceId: selectedChoice.id,
    risk: selectedChoice.risk,
    reward: selectedChoice.reward,
    voterCount: votesByChoice[selectedChoice.id] ?? 0,
    totalVoters: players.length,
    policy: dominantProgressPolicy(state),
  };
  state.decisionIndex += 1;
  state.activeDecision = null;
  state.lastDecision = summary;
  applyDecisionChoice(state, selectedChoice, events);
  events.push({ type: "decision_resolved", decision: summary });
  return true;
}

function overrideDecision(
  state: GameState,
  id: PlayerId,
  decisionId: string,
  choiceId: string,
  content: GameContent,
  events: GameEvent[],
): string | null {
  if (state.status !== "running") {
    return "match_not_running";
  }
  const activeDecision = state.activeDecision;
  if (activeDecision === null) {
    return "no_active_decision";
  }
  if (activeDecision.decisionId !== decisionId) {
    return "decision_expired";
  }
  if (state.players[id] === undefined) {
    return "player_not_found";
  }
  if (!activeDecision.choices.some((choice) => choice.id === choiceId)) {
    return "decision_choice_not_found";
  }

  activeDecision.votes[id] = choiceId;
  if (!activeDecision.overriddenPlayerIds.includes(id)) {
    activeDecision.overriddenPlayerIds.push(id);
  }
  events.push({ type: "decision_overridden", playerId: id, decisionId, choiceId });
  if (resolveActiveDecisionWhenReady(state, content, events)) {
    spawnWaveWhenNeeded(state, content, events, false);
  }
  return null;
}

function requestRescue(
  state: GameState,
  rescuerId: PlayerId,
  targetId: PlayerId,
  events: GameEvent[],
): string | null {
  if (state.status !== "running") {
    return "match_not_running";
  }
  if (rescuerId === targetId) {
    return "rescue_self_not_allowed";
  }
  const rescuer = state.players[rescuerId];
  const target = state.players[targetId];
  if (rescuer === undefined || target === undefined) {
    return "player_not_found";
  }
  if (!isPlayerActive(rescuer)) {
    return "player_unavailable";
  }
  if (!target.downed || target.eliminated) {
    return "rescue_target_unavailable";
  }
  if (rescuer.rescueCooldownMs > 0) {
    return "rescue_on_cooldown";
  }
  if (rescuer.rescueTargetId !== null && rescuer.rescueTargetId !== target.id) {
    return "rescue_in_progress";
  }
  if (rescuer.rescueTargetId === target.id) {
    return null;
  }

  rescuer.rescueTargetId = target.id;
  rescuer.rescueProgressMs = 0;
  events.push({ type: "rescue_started", rescuerId, targetId });
  return null;
}

function updateRescueCooldowns(state: GameState, elapsedMs: number): void {
  for (const player of Object.values(state.players)) {
    player.rescueCooldownMs = Math.max(0, player.rescueCooldownMs - elapsedMs);
  }
}

function assignAutomaticRescues(state: GameState, events: GameEvent[]): void {
  const reservedTargets = new Set<string>();
  for (const player of Object.values(state.players)) {
    if (player.rescueTargetId !== null) {
      reservedTargets.add(player.rescueTargetId);
    }
  }

  for (const rescuer of Object.values(state.players)) {
    if (
      !isPlayerActive(rescuer) ||
      rescuer.rescueTargetId !== null ||
      rescuer.rescueCooldownMs > 0 ||
      rescuer.automation.rescue === "off"
    ) {
      continue;
    }
    const target = selectAutomaticRescueTarget(state, reservedTargets, rescuer.automation.rescue);
    if (target === null) {
      continue;
    }
    rescuer.rescueTargetId = target.id;
    rescuer.rescueProgressMs = 0;
    reservedTargets.add(target.id);
    events.push({ type: "rescue_started", rescuerId: rescuer.id, targetId: target.id });
  }
}

function selectAutomaticRescueTarget(
  state: GameState,
  reservedTargets: ReadonlySet<string>,
  policy: RescuePolicy,
): PlayerState | null {
  const candidates = Object.values(state.players).filter(
    (player) =>
      player.downed &&
      !player.eliminated &&
      player.rescueDeadlineMs !== null &&
      !reservedTargets.has(player.id),
  );
  if (candidates.length === 0) {
    return null;
  }
  const sorted = [...candidates].sort((left, right) => {
    if (policy === "priority") {
      const leftDeadline = left.rescueDeadlineMs ?? Number.MAX_SAFE_INTEGER;
      const rightDeadline = right.rescueDeadlineMs ?? Number.MAX_SAFE_INTEGER;
      if (leftDeadline !== rightDeadline) {
        return leftDeadline - rightDeadline;
      }
    }
    const leftDownedAt = left.downedAtMs ?? Number.MAX_SAFE_INTEGER;
    const rightDownedAt = right.downedAtMs ?? Number.MAX_SAFE_INTEGER;
    if (leftDownedAt !== rightDownedAt) {
      return leftDownedAt - rightDownedAt;
    }
    return left.id.localeCompare(right.id);
  });
  return sorted[0] ?? null;
}

function progressRescues(state: GameState, elapsedMs: number, events: GameEvent[]): void {
  const rescuers = Object.values(state.players);
  for (const rescuer of rescuers) {
    const targetId = rescuer.rescueTargetId;
    if (targetId === null) {
      continue;
    }
    const target = state.players[targetId];
    if (!isPlayerActive(rescuer) || target?.downed !== true) {
      clearRescueAttempt(rescuer);
      continue;
    }
    rescuer.rescueProgressMs += elapsedMs;
    const deadline = target.rescueDeadlineMs;
    if (rescuer.rescueProgressMs < getRescueActionDurationMs(rescuer) || deadline === null) {
      continue;
    }
    if (state.elapsedMs > deadline) {
      clearRescueAttempt(rescuer);
      continue;
    }

    target.downed = false;
    target.eliminated = false;
    target.hp = Math.max(1, Math.round((target.maxHp * RESCUE_REVIVAL_HP_PERCENT) / 100));
    target.shield = 0;
    target.downedAtMs = null;
    target.rescueDeadlineMs = null;
    target.rescueTargetId = null;
    target.rescueProgressMs = 0;
    rescuer.rescueCooldownMs = RESCUE_COOLDOWN_MS;
    const rescuedTargetId = target.id;
    clearRescueAttempt(rescuer);
    events.push({
      type: "player_rescued",
      rescuerId: rescuer.id,
      targetId: rescuedTargetId,
      hp: target.hp,
    });
  }

  for (const player of Object.values(state.players)) {
    if (
      !player.downed ||
      player.rescueDeadlineMs === null ||
      state.elapsedMs < player.rescueDeadlineMs
    ) {
      continue;
    }
    player.downed = false;
    player.eliminated = true;
    player.downedAtMs = null;
    player.rescueDeadlineMs = null;
    player.rescueTargetId = null;
    player.rescueProgressMs = 0;
    events.push({ type: "player_eliminated", playerId: player.id });
  }
}

function clearRescueAttempt(player: PlayerState): void {
  player.rescueTargetId = null;
  player.rescueProgressMs = 0;
}

function markPlayerDowned(state: GameState, player: PlayerState, events: GameEvent[]): void {
  player.downed = true;
  player.downedAtMs = state.elapsedMs;
  player.rescueDeadlineMs = state.elapsedMs + getRescueWindowDurationMs(player);
  clearRescueAttempt(player);
  events.push({
    type: "player_downed",
    playerId: player.id,
    rescueDeadlineMs: player.rescueDeadlineMs,
  });
}

function toDecisionChoicePreview(choice: ExpeditionChoiceDefinition): DecisionChoicePreview {
  return {
    id: choice.id,
    kind: choice.kind,
    risk: choice.risk,
    reward: choice.reward,
    ...(choice.healPercent === undefined ? {} : { healPercent: choice.healPercent }),
    ...(choice.damagePercent === undefined ? {} : { damagePercent: choice.damagePercent }),
  };
}

function cloneActiveDecision(source: ActiveDecision): ActiveDecision {
  return {
    ...source,
    choices: source.choices.map((choice) => ({ ...choice })),
    votes: { ...source.votes },
    overriddenPlayerIds: [...source.overriddenPlayerIds],
  };
}

function choosePlayerDecision(
  policy: PlayerState["automation"]["progress"],
  choices: readonly ExpeditionChoiceDefinition[],
): ExpeditionChoiceDefinition {
  const first = choices[0];
  if (first === undefined) {
    throw new Error("Decision must contain at least one choice");
  }
  let best = first;
  let bestScore = decisionScore(policy, best);
  for (const choice of choices.slice(1)) {
    const score = decisionScore(policy, choice);
    if (score > bestScore || (score === bestScore && compareDecisionChoices(choice, best) < 0)) {
      best = choice;
      bestScore = score;
    }
  }
  return best;
}

function chooseWinningDecision(
  choices: readonly ExpeditionChoiceDefinition[],
): ExpeditionChoiceDefinition {
  const first = choices[0];
  if (first === undefined) {
    throw new Error("Decision must contain at least one tied choice");
  }
  let safest = first;
  for (const choice of choices.slice(1)) {
    if (compareDecisionChoices(choice, safest) < 0) {
      safest = choice;
    }
  }
  return safest;
}

function compareDecisionChoices(
  left: ExpeditionChoiceDefinition,
  right: ExpeditionChoiceDefinition,
): number {
  if (left.risk !== right.risk) {
    return left.risk - right.risk;
  }
  if (left.reward !== right.reward) {
    return right.reward - left.reward;
  }
  return left.id.localeCompare(right.id);
}

function decisionScore(
  policy: PlayerState["automation"]["progress"],
  choice: ExpeditionChoiceDefinition,
): number {
  const healing = choice.healPercent ?? 0;
  switch (policy) {
    case "safe":
      return (100 - choice.risk) * 3 + healing * 4 + choice.reward;
    case "balanced":
      return choice.reward * 2 + healing * 3 - choice.risk * 2;
    case "reward":
      return choice.reward * 4 + healing - choice.risk;
    case "exploration":
      return (choice.kind === "mystery" ? 120 : 0) + choice.reward * 2 - choice.risk;
  }
}

function dominantProgressPolicy(state: GameState): ProgressPolicy {
  const counts: Record<ProgressPolicy, number> = {
    safe: 0,
    balanced: 0,
    reward: 0,
    exploration: 0,
  };
  for (const player of Object.values(state.players)) {
    counts[player.automation.progress] += 1;
  }
  let selected: ProgressPolicy = "balanced";
  for (const policy of ["safe", "balanced", "reward", "exploration"] as const) {
    if (counts[policy] > counts[selected]) {
      selected = policy;
    }
  }
  return selected;
}

function applyDecisionChoice(
  state: GameState,
  choice: ExpeditionChoiceDefinition,
  events: GameEvent[],
): void {
  for (const player of Object.values(state.players)) {
    if (!isPlayerActive(player)) {
      continue;
    }
    player.score += choice.reward;
    const healAmount = Math.round((player.maxHp * (choice.healPercent ?? 0)) / 100);
    if (healAmount > 0) {
      player.hp = Math.min(player.maxHp, player.hp + healAmount);
    }
    const damageAmount = Math.min(
      player.hp,
      Math.round((player.maxHp * (choice.damagePercent ?? 0)) / 100),
    );
    if (damageAmount > 0) {
      player.hp -= damageAmount;
      player.stats.damageTaken += damageAmount;
      events.push({
        type: "damage",
        sourcePlayerId: null,
        enemyId: null,
        targetPlayerId: player.id,
        amount: damageAmount,
      });
      if (player.hp === 0) {
        markPlayerDowned(state, player, events);
      }
    }
  }
}

function shouldAutoRetreat(state: GameState, content: GameContent, events: GameEvent[]): boolean {
  if (state.waveIndex <= 0 || state.waveIndex >= content.stage.waves.length) {
    return false;
  }
  const players = Object.values(state.players);
  if (players.length > 0 && players.every((player) => !isPlayerActive(player))) {
    return false;
  }
  const totalMaxHp = players.reduce((total, player) => total + player.maxHp, 0);
  if (totalMaxHp <= 0) {
    return false;
  }
  const totalHp = players.reduce((total, player) => total + player.hp, 0);
  const averageHpPercent = Math.round((totalHp / totalMaxHp) * 100);
  const threshold = retreatThreshold(dominantRetreatPolicy(state));
  if (averageHpPercent > threshold) {
    return false;
  }
  const policy = dominantRetreatPolicy(state);
  events.push({
    type: "retreat_decided",
    policy,
    reason: "health_threshold",
    averageHpPercent,
  });
  endMatch(state, "return", content, events);
  return true;
}

function dominantRetreatPolicy(state: GameState): RetreatPolicy {
  const counts: Record<RetreatPolicy, number> = {
    early: 0,
    standard: 0,
    last_stand: 0,
  };
  for (const player of Object.values(state.players)) {
    counts[player.automation.retreat] += 1;
  }
  let selected: RetreatPolicy = "standard";
  for (const policy of ["early", "standard", "last_stand"] as const) {
    if (counts[policy] > counts[selected]) {
      selected = policy;
    }
  }
  return selected;
}

function retreatThreshold(policy: PlayerState["automation"]["retreat"]): number {
  switch (policy) {
    case "early":
      return 55;
    case "standard":
      return 25;
    case "last_stand":
      return 8;
  }
}

function spawnWave(state: GameState, content: GameContent, events: GameEvent[]): void {
  const wave = content.stage.waves[state.waveIndex];
  if (wave === undefined) {
    endMatch(state, "victory", content, events);
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
  for (const player of Object.values(state.players)) {
    if (isPlayerActive(player) && player.waveShieldBonus > 0) {
      player.shield += player.waveShieldBonus;
    }
  }
  events.push({ type: "wave_spawned", waveIndex: currentWaveIndex });
}

function evaluateDefeat(state: GameState, content: GameContent, events: GameEvent[]): void {
  const players = Object.values(state.players);
  if (players.length > 0 && players.every((player) => !isPlayerActive(player))) {
    endMatch(state, "defeat", content, events);
  }
}

function isPlayerActive(player: PlayerState): boolean {
  return !player.downed && !player.eliminated && player.hp > 0;
}

function endMatch(
  state: GameState,
  outcome: MatchResult["outcome"],
  content: GameContent,
  events: GameEvent[],
): void {
  if (state.result !== null) {
    return;
  }
  state.status = outcome;
  const unlocks = createMatchUnlocks(state, outcome, content);
  state.result = {
    outcome,
    durationMs: state.elapsedMs,
    completedAtTick: state.tick,
    rewards: createMatchRewards(state, outcome, content),
    unlocks,
  };
  for (const player of Object.values(state.players)) {
    for (const unlockId of unlocks[player.id] ?? []) {
      const unlock = content.unlocks[unlockId];
      if (unlock !== undefined && !player.unlockedContentIds.includes(unlock.contentId)) {
        player.unlockedContentIds.push(unlock.contentId);
      }
    }
  }
  events.push({ type: "match_ended", result: state.result });
}

function createMatchUnlocks(
  state: GameState,
  outcome: MatchResult["outcome"],
  content: GameContent,
): Readonly<Record<string, readonly string[]>> {
  const definitions = Object.values(content.unlocks).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const unlocks: Record<string, readonly string[]> = {};
  for (const player of Object.values(state.players)) {
    unlocks[player.id] = definitions
      .filter(
        (unlock) =>
          unlock.condition.type === "match_outcome" &&
          unlock.condition.outcome === outcome &&
          !player.unlockedContentIds.includes(unlock.contentId),
      )
      .map((unlock) => unlock.id);
  }
  return unlocks;
}

function createMatchRewards(
  state: GameState,
  outcome: MatchResult["outcome"],
  content: GameContent,
): Readonly<Record<string, MatchReward>> {
  const policy = content.rewardPolicy;
  const rewards: Record<string, MatchReward> = {};
  for (const player of Object.values(state.players)) {
    rewards[player.id] = {
      currency: Math.max(
        0,
        Math.floor(
          policy.currencyBaseByOutcome[outcome] +
            state.waveIndex * policy.currencyPerWave +
            player.score * policy.currencyPerScore,
        ),
      ),
      experience: Math.max(
        0,
        Math.floor(
          policy.experienceBaseByOutcome[outcome] +
            state.waveIndex * policy.experiencePerWave +
            player.stats.enemiesDefeated * policy.experiencePerEnemyDefeated,
        ),
      ),
    };
  }
  return rewards;
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

  const enemies: Record<string, EnemyState> = {};
  for (const [id, enemy] of Object.entries(source.enemies)) {
    enemies[id] = { ...enemy };
  }

  return {
    ...source,
    players,
    enemies,
    processedActionIds: [...source.processedActionIds],
    activeDecision:
      source.activeDecision === null ? null : cloneActiveDecision(source.activeDecision),
    lastDecision: source.lastDecision === null ? null : { ...source.lastDecision },
    result:
      source.result === null
        ? null
        : {
            ...source.result,
            rewards: Object.fromEntries(
              Object.entries(source.result.rewards).map(([playerId, reward]) => [
                playerId,
                { ...reward },
              ]),
            ),
            unlocks: Object.fromEntries(
              Object.entries(source.result.unlocks).map(([playerId, unlockIds]) => [
                playerId,
                [...unlockIds],
              ]),
            ),
          },
  };
}

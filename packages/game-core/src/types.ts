import type { ActionId, EnemyId, MatchId, PlayerId } from "./ids.js";
import type { HeroClassId } from "./content.js";

export type MatchStatus = "lobby" | "running" | "victory" | "defeat";
export type ConnectionState = "connected" | "ai_controlled";

export interface PlayerCombatStats {
  damageDealt: number;
  healingDone: number;
  damageTaken: number;
  enemiesDefeated: number;
}

export interface PlayerState {
  readonly id: PlayerId;
  displayName: string;
  classId: HeroClassId;
  ready: boolean;
  connection: ConnectionState;
  hp: number;
  maxHp: number;
  shield: number;
  level: number;
  experience: number;
  nextLevelExperience: number;
  attackPower: number;
  attackIntervalMs: number;
  attackCooldownMs: number;
  skillCooldownMultiplier: number;
  healingMultiplier: number;
  skillCooldowns: Record<string, number>;
  upgrades: string[];
  pendingUpgradeChoices: string[];
  score: number;
  stats: PlayerCombatStats;
}

export interface EnemyState {
  readonly id: EnemyId;
  readonly definitionId: string;
  hp: number;
  maxHp: number;
  attackPower: number;
  attackIntervalMs: number;
  attackCooldownMs: number;
  boss: boolean;
}

export interface MatchResult {
  readonly outcome: "victory" | "defeat";
  readonly durationMs: number;
  readonly completedAtTick: number;
}

export interface GameState {
  readonly schemaVersion: 1;
  readonly matchId: MatchId;
  readonly seed: string;
  readonly rulesetVersion: string;
  readonly contentVersion: string;
  status: MatchStatus;
  tick: number;
  elapsedMs: number;
  randomState: number;
  waveIndex: number;
  spawnSequence: number;
  players: Record<string, PlayerState>;
  enemies: Record<string, EnemyState>;
  processedActionIds: ActionId[];
  result: MatchResult | null;
}

export type GameCommand =
  | {
      readonly type: "join_player";
      readonly actionId: ActionId;
      readonly playerId: PlayerId;
      readonly displayName: string;
      readonly classId: HeroClassId;
    }
  | {
      readonly type: "set_ready";
      readonly actionId: ActionId;
      readonly playerId: PlayerId;
      readonly ready: boolean;
    }
  | {
      readonly type: "select_class";
      readonly actionId: ActionId;
      readonly playerId: PlayerId;
      readonly classId: HeroClassId;
    }
  | {
      readonly type: "start_match";
      readonly actionId: ActionId;
      readonly playerId: PlayerId;
    }
  | {
      readonly type: "cast_skill";
      readonly actionId: ActionId;
      readonly playerId: PlayerId;
      readonly skillId: string;
    }
  | {
      readonly type: "select_upgrade";
      readonly actionId: ActionId;
      readonly playerId: PlayerId;
      readonly upgradeId: string;
    }
  | {
      readonly type: "disconnect_player";
      readonly actionId: ActionId;
      readonly playerId: PlayerId;
    }
  | {
      readonly type: "reconnect_player";
      readonly actionId: ActionId;
      readonly playerId: PlayerId;
      readonly displayName: string;
    };

export type GameEvent =
  | { readonly type: "player_joined"; readonly playerId: PlayerId }
  | { readonly type: "player_disconnected"; readonly playerId: PlayerId }
  | { readonly type: "player_reconnected"; readonly playerId: PlayerId }
  | { readonly type: "match_started" }
  | {
      readonly type: "damage";
      readonly sourcePlayerId: PlayerId | null;
      readonly enemyId: EnemyId | null;
      readonly targetPlayerId: PlayerId | null;
      readonly amount: number;
    }
  | { readonly type: "healing"; readonly sourcePlayerId: PlayerId; readonly amount: number }
  | { readonly type: "enemy_defeated"; readonly enemyId: EnemyId }
  | { readonly type: "wave_spawned"; readonly waveIndex: number }
  | {
      readonly type: "upgrade_choices_created";
      readonly playerId: PlayerId;
      readonly choices: readonly string[];
    }
  | {
      readonly type: "upgrade_selected";
      readonly playerId: PlayerId;
      readonly upgradeId: string;
    }
  | { readonly type: "match_ended"; readonly result: MatchResult };

export interface CommandResult {
  readonly accepted: boolean;
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly errorCode: string | null;
}

export interface StepResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

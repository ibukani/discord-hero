import type { ActionId, EnemyId, MatchId, PlayerId } from "./ids.js";
import type { ExpeditionChoiceKind, ExpeditionDecisionKind, HeroClassId } from "./content.js";

export type MatchStatus = "lobby" | "running" | "victory" | "defeat" | "return";
export type ConnectionState = "connected" | "ai_controlled";
export type GrowthPolicy = "adaptive" | "offense" | "survival" | "skill" | "support";
export type ProgressPolicy = "safe" | "balanced" | "reward" | "exploration";
export type RetreatPolicy = "early" | "standard" | "last_stand";
export type RescuePolicy = "off" | "standard" | "priority";

export interface AutomationPolicy {
  growth: GrowthPolicy;
  progress: ProgressPolicy;
  retreat: RetreatPolicy;
  rescue: RescuePolicy;
}

export interface DecisionSummary {
  readonly kind: ExpeditionDecisionKind;
  readonly decisionId: string;
  readonly choiceId: string;
  readonly risk: number;
  readonly reward: number;
  readonly voterCount: number;
  readonly totalVoters: number;
  readonly policy: ProgressPolicy;
}

export interface DecisionChoicePreview {
  readonly id: string;
  readonly kind: ExpeditionChoiceKind;
  readonly risk: number;
  readonly reward: number;
  readonly healPercent?: number;
  readonly damagePercent?: number;
}

export interface ActiveDecision {
  readonly kind: ExpeditionDecisionKind;
  readonly decisionId: string;
  readonly choices: readonly DecisionChoicePreview[];
  readonly openedAtMs: number;
  readonly deadlineMs: number;
  votes: Record<string, string>;
  overriddenPlayerIds: string[];
}

export interface PlayerLoadout {
  activeSkillIds: string[];
  weaponId: string | null;
  armorId: string | null;
  accessoryId: string | null;
}

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
  downed: boolean;
  eliminated: boolean;
  downedAtMs: number | null;
  rescueDeadlineMs: number | null;
  rescueTargetId: PlayerId | null;
  rescueProgressMs: number;
  rescueCooldownMs: number;
  rescueDurationMultiplier: number;
  waveShieldBonus: number;
  activeSynergyIds: string[];
  level: number;
  experience: number;
  nextLevelExperience: number;
  attackPower: number;
  attackIntervalMs: number;
  attackCooldownMs: number;
  loadout: PlayerLoadout;
  automation: AutomationPolicy;
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
  readonly outcome: "victory" | "defeat" | "return";
  readonly durationMs: number;
  readonly completedAtTick: number;
  readonly rewards: Readonly<Record<string, MatchReward>>;
}

export interface MatchReward {
  readonly currency: number;
  readonly experience: number;
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
  decisionIndex: number;
  activeDecision: ActiveDecision | null;
  lastDecision: DecisionSummary | null;
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
      readonly type: "set_automation_policy";
      readonly actionId: ActionId;
      readonly playerId: PlayerId;
      readonly policy: AutomationPolicy;
    }
  | {
      readonly type: "set_loadout";
      readonly actionId: ActionId;
      readonly playerId: PlayerId;
      readonly activeSkillIds: readonly string[];
    }
  | {
      readonly type: "set_equipment";
      readonly actionId: ActionId;
      readonly playerId: PlayerId;
      readonly weaponId: string | null;
      readonly armorId: string | null;
      readonly accessoryId: string | null;
    }
  | {
      readonly type: "start_match";
      readonly actionId: ActionId;
      readonly playerId: PlayerId;
    }
  | {
      readonly type: "restart_match";
      readonly actionId: ActionId;
      readonly playerId: PlayerId;
      readonly matchId: MatchId;
      readonly seed: string;
    }
  | {
      readonly type: "return_to_lobby";
      readonly actionId: ActionId;
      readonly playerId: PlayerId;
      readonly matchId: MatchId;
      readonly seed: string;
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
      readonly type: "override_decision";
      readonly actionId: ActionId;
      readonly playerId: PlayerId;
      readonly decisionId: string;
      readonly choiceId: string;
    }
  | {
      readonly type: "rescue_player";
      readonly actionId: ActionId;
      readonly playerId: PlayerId;
      readonly targetPlayerId: PlayerId;
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
  | { readonly type: "decision_opened"; readonly decision: ActiveDecision }
  | {
      readonly type: "decision_overridden";
      readonly playerId: PlayerId;
      readonly decisionId: string;
      readonly choiceId: string;
    }
  | {
      readonly type: "decision_resolved";
      readonly decision: DecisionSummary;
    }
  | {
      readonly type: "retreat_decided";
      readonly policy: RetreatPolicy;
      readonly reason: string;
      readonly averageHpPercent: number;
    }
  | {
      readonly type: "player_downed";
      readonly playerId: PlayerId;
      readonly rescueDeadlineMs: number;
    }
  | {
      readonly type: "rescue_started";
      readonly rescuerId: PlayerId;
      readonly targetId: PlayerId;
    }
  | {
      readonly type: "player_rescued";
      readonly rescuerId: PlayerId;
      readonly targetId: PlayerId;
      readonly hp: number;
    }
  | {
      readonly type: "player_eliminated";
      readonly playerId: PlayerId;
    }
  | {
      readonly type: "equipment_changed";
      readonly playerId: PlayerId;
      readonly weaponId: string | null;
      readonly armorId: string | null;
      readonly accessoryId: string | null;
      readonly synergyIds: readonly string[];
    }
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
  | {
      readonly type: "skill_used";
      readonly playerId: PlayerId;
      readonly skillId: string;
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

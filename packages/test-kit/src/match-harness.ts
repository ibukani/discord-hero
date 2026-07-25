import { DEFAULT_CONTENT } from "@discord-hero/content";
import {
  actionId,
  applyCommand,
  createGame,
  matchId,
  playerId,
  stepGame,
  type ActionId,
  type CommandResult,
  type GameCommand,
  type GameContent,
  type GameEvent,
  type GameState,
  type HeroClassId,
  type PlayerId,
} from "@discord-hero/game-core";

export type HarnessOperation =
  | { readonly type: "command"; readonly command: GameCommand }
  | { readonly type: "step"; readonly elapsedMs: number };

export interface MatchHarnessOptions {
  readonly matchId?: string;
  readonly seed?: string;
  readonly content?: GameContent;
}

export interface RunUntilOptions {
  readonly stepMs?: number;
  readonly maxSteps?: number;
}

export class MatchHarness {
  private currentState: GameState;
  private readonly content: GameContent;
  private nextActionSequence = 1;
  private readonly operationLog: HarnessOperation[] = [];
  private readonly eventLog: GameEvent[] = [];

  public constructor(options: MatchHarnessOptions = {}) {
    this.content = options.content ?? DEFAULT_CONTENT;
    this.currentState = createGame({
      matchId: matchId(options.matchId ?? "test-match"),
      seed: options.seed ?? "test-seed",
      content: this.content,
    });
  }

  public get state(): Readonly<GameState> {
    return this.currentState;
  }

  public get operations(): readonly HarnessOperation[] {
    return this.operationLog;
  }

  public get events(): readonly GameEvent[] {
    return this.eventLog;
  }

  public createActionId(label = "action"): ActionId {
    const value = actionId(`${label}-${this.nextActionSequence}`);
    this.nextActionSequence += 1;
    return value;
  }

  public dispatch(command: GameCommand): CommandResult {
    const result = applyCommand(this.currentState, command, this.content);
    this.operationLog.push({ type: "command", command });
    if (result.accepted) {
      this.currentState = result.state;
      this.eventLog.push(...result.events);
    }
    return result;
  }

  public join(
    id: string,
    displayName: string,
    classId: HeroClassId,
    providedActionId = this.createActionId("join"),
  ): CommandResult {
    return this.dispatch({
      type: "join_player",
      actionId: providedActionId,
      playerId: playerId(id),
      displayName,
      classId,
    });
  }

  public setReady(
    id: string,
    ready = true,
    providedActionId = this.createActionId("ready"),
  ): CommandResult {
    return this.dispatch({
      type: "set_ready",
      actionId: providedActionId,
      playerId: playerId(id),
      ready,
    });
  }

  public start(id: string, providedActionId = this.createActionId("start")): CommandResult {
    return this.dispatch({
      type: "start_match",
      actionId: providedActionId,
      playerId: playerId(id),
    });
  }

  public castSkill(
    id: string,
    skillId: string,
    providedActionId = this.createActionId("skill"),
  ): CommandResult {
    return this.dispatch({
      type: "cast_skill",
      actionId: providedActionId,
      playerId: playerId(id),
      skillId,
    });
  }

  public selectUpgrade(
    id: string,
    upgradeId: string,
    providedActionId = this.createActionId("upgrade"),
  ): CommandResult {
    return this.dispatch({
      type: "select_upgrade",
      actionId: providedActionId,
      playerId: playerId(id),
      upgradeId,
    });
  }

  public disconnect(
    id: string,
    providedActionId = this.createActionId("disconnect"),
  ): CommandResult {
    return this.dispatch({
      type: "disconnect_player",
      actionId: providedActionId,
      playerId: playerId(id),
    });
  }

  public reconnect(
    id: string,
    displayName: string,
    providedActionId = this.createActionId("reconnect"),
  ): CommandResult {
    return this.dispatch({
      type: "reconnect_player",
      actionId: providedActionId,
      playerId: playerId(id),
      displayName,
    });
  }

  public step(elapsedMs = 100): readonly GameEvent[] {
    const result = stepGame(this.currentState, elapsedMs, this.content);
    this.currentState = result.state;
    this.operationLog.push({ type: "step", elapsedMs });
    this.eventLog.push(...result.events);
    return result.events;
  }

  public runUntil(
    predicate: (state: Readonly<GameState>) => boolean,
    options: RunUntilOptions = {},
  ): number {
    const stepMs = options.stepMs ?? 100;
    const maxSteps = options.maxSteps ?? 10_000;

    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
      if (predicate(this.currentState)) {
        return stepIndex;
      }
      this.step(stepMs);
    }

    if (predicate(this.currentState)) {
      return maxSteps;
    }
    throw new Error(`Predicate was not satisfied after ${maxSteps} steps`);
  }

  public player(id: string): Readonly<NonNullable<GameState["players"][string]>> {
    const player = this.currentState.players[id];
    if (player === undefined) {
      throw new Error(`Player ${id} does not exist`);
    }
    return player;
  }
}

export function replayOperations(
  operations: readonly HarnessOperation[],
  options: MatchHarnessOptions = {},
): Readonly<GameState> {
  const harness = new MatchHarness(options);
  for (const operation of operations) {
    if (operation.type === "command") {
      const result = harness.dispatch(operation.command);
      if (!result.accepted) {
        throw new Error(`Replay rejected command: ${result.errorCode ?? "unknown"}`);
      }
    } else {
      harness.step(operation.elapsedMs);
    }
  }
  return harness.state;
}

export function asPlayerId(value: string): PlayerId {
  return playerId(value);
}

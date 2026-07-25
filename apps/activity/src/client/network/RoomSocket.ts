import { CURRENT_CONTENT } from "@discord-hero/content";
import {
  PROTOCOL_VERSION,
  GAME_WEBSOCKET_PROTOCOL,
  RoomTicketResponseSchema,
  parseServerMessage,
  type ClientMessage,
  type GrowthPolicyDto,
  type HeroClassIdDto,
  type ProgressPolicyDto,
  type RescuePolicyDto,
  type RetreatPolicyDto,
  type ServerMessage,
} from "@discord-hero/protocol";
import { postJson } from "../api/http.js";
import type { PlatformSession } from "../platform/types.js";
import { PendingCommandBuffer, type PendingCommand } from "./pending-commands.js";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

export interface RoomSocketCallbacks {
  readonly onStatus: (status: ConnectionStatus) => void;
  readonly onMessage: (message: ServerMessage) => void;
  readonly onError: (message: string) => void;
}

type ReliableIntent =
  | { readonly type: "set_ready"; readonly ready: boolean }
  | { readonly type: "select_class"; readonly classId: HeroClassIdDto }
  | { readonly type: "restart_match" }
  | { readonly type: "return_to_lobby" }
  | {
      readonly type: "set_automation_policy";
      readonly policy: {
        readonly growth: GrowthPolicyDto;
        readonly progress: ProgressPolicyDto;
        readonly retreat: RetreatPolicyDto;
        readonly rescue: RescuePolicyDto;
      };
    }
  | { readonly type: "set_loadout"; readonly activeSkillIds: string[] }
  | {
      readonly type: "set_equipment";
      readonly weaponId: string | null;
      readonly armorId: string | null;
      readonly accessoryId: string | null;
    }
  | { readonly type: "start_match" }
  | { readonly type: "cast_skill"; readonly skillId: string }
  | { readonly type: "select_upgrade"; readonly upgradeId: string }
  | {
      readonly type: "override_decision";
      readonly decisionId: string;
      readonly choiceId: string;
    }
  | { readonly type: "rescue_player"; readonly targetPlayerId: string };

const MAX_PENDING_COMMANDS = 128;

export class RoomSocket {
  private socket: WebSocket | null = null;
  private disposed = false;
  private welcomed = false;
  private syncRequested = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private lastStateRevision: number | null = null;
  private selectedClassId: HeroClassIdDto;
  private readonly pendingCommands = new PendingCommandBuffer(MAX_PENDING_COMMANDS);

  public constructor(
    private readonly session: PlatformSession,
    private readonly callbacks: RoomSocketCallbacks,
  ) {
    this.selectedClassId = session.initialClassId;
  }

  public async connect(): Promise<void> {
    this.disposed = false;
    await this.openSocket(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
  }

  public setReady(ready: boolean): void {
    this.sendReliable({ type: "set_ready", ready });
  }

  public selectClass(classId: HeroClassIdDto): void {
    this.selectedClassId = classId;
    this.sendReliable({ type: "select_class", classId });
  }

  public setAutomationPolicy(policy: {
    readonly growth: GrowthPolicyDto;
    readonly progress: ProgressPolicyDto;
    readonly retreat: RetreatPolicyDto;
    readonly rescue: RescuePolicyDto;
  }): void {
    this.sendReliable({ type: "set_automation_policy", policy });
  }

  public setLoadout(activeSkillIds: readonly string[]): void {
    this.sendReliable({ type: "set_loadout", activeSkillIds: [...activeSkillIds] });
  }

  public setEquipment(
    weaponId: string | null,
    armorId: string | null,
    accessoryId: string | null,
  ): void {
    this.sendReliable({ type: "set_equipment", weaponId, armorId, accessoryId });
  }

  public startMatch(): void {
    this.sendReliable({ type: "start_match" });
  }

  public restartMatch(): void {
    this.sendReliable({ type: "restart_match" });
  }

  public returnToLobby(): void {
    this.sendReliable({ type: "return_to_lobby" });
  }

  public castSkill(skillId: string): void {
    this.sendReliable({ type: "cast_skill", skillId });
  }

  public selectUpgrade(upgradeId: string): void {
    this.sendReliable({ type: "select_upgrade", upgradeId });
  }

  public overrideDecision(decisionId: string, choiceId: string): void {
    this.sendReliable({ type: "override_decision", decisionId, choiceId });
  }

  public rescuePlayer(targetPlayerId: string): void {
    this.sendReliable({ type: "rescue_player", targetPlayerId });
  }

  public close(): void {
    this.disposed = true;
    this.welcomed = false;
    this.clearTimers();
    this.pendingCommands.clear();
    this.socket?.close(1000, "Client disposed");
    this.socket = null;
    this.callbacks.onStatus("closed");
  }

  private async openSocket(status: "connecting" | "reconnecting"): Promise<void> {
    this.callbacks.onStatus(status);
    try {
      const ticket = await postJson(
        "/api/rooms/ticket",
        { roomId: this.session.roomId },
        RoomTicketResponseSchema,
        this.session.sessionToken,
      );
      if (this.disposed) {
        return;
      }

      const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socketUrl = `${scheme}//${window.location.host}/api/rooms/${encodeURIComponent(this.session.roomId)}/socket`;
      const socket = new WebSocket(socketUrl, [GAME_WEBSOCKET_PROTOCOL, `auth.${ticket.ticket}`]);
      this.socket = socket;

      socket.addEventListener("open", () => {
        if (this.socket !== socket || this.disposed) {
          socket.close();
          return;
        }
        this.reconnectAttempt = 0;
        this.welcomed = false;
        this.syncRequested = false;
        this.callbacks.onStatus("connected");
        this.sendEphemeral({
          protocolVersion: PROTOCOL_VERSION,
          type: "hello",
          actionId: crypto.randomUUID(),
          classId: this.selectedClassId,
          rulesetVersion: CURRENT_CONTENT.rulesetVersion,
          contentVersion: CURRENT_CONTENT.version,
          lastStateRevision: this.lastStateRevision,
        });
        this.startPing();
      });

      socket.addEventListener("message", (event: MessageEvent<unknown>) => {
        this.handleIncoming(event.data);
      });

      socket.addEventListener("error", () => {
        this.callbacks.onError("WebSocket接続でエラーが発生しました。");
      });

      socket.addEventListener("close", () => {
        if (this.socket === socket) {
          this.socket = null;
        }
        this.welcomed = false;
        this.stopPing();
        if (!this.disposed) {
          this.scheduleReconnect();
        }
      });
    } catch (error: unknown) {
      this.callbacks.onError(errorMessage(error));
      if (!this.disposed) {
        this.scheduleReconnect();
      }
    }
  }

  private handleIncoming(input: unknown): void {
    if (typeof input !== "string") {
      this.callbacks.onError("未対応のサーバーメッセージを受信しました。");
      return;
    }
    try {
      const message = parseServerMessage(JSON.parse(input) as unknown);
      if (message.type === "command_ack" || message.type === "command_rejected") {
        this.pendingCommands.settle(message.actionId);
      }

      if (message.type === "welcome" || message.type === "snapshot") {
        this.lastStateRevision = message.stateRevision;
        this.syncRequested = false;
      } else {
        const previousRevision = this.lastStateRevision;
        if (
          message.type === "events" &&
          previousRevision !== null &&
          message.stateRevision > previousRevision + 1
        ) {
          this.requestSnapshot();
        }
        this.lastStateRevision = Math.max(previousRevision ?? 0, message.stateRevision);
      }

      this.callbacks.onMessage(message);
      if (message.type === "welcome") {
        this.welcomed = true;
        this.resendPendingCommands();
      }
      if (
        message.type === "error" &&
        (message.code === "unsupported_content" ||
          message.code === "unsupported_protocol" ||
          message.code === "state_recovery_failed")
      ) {
        this.disposed = true;
        this.clearTimers();
        this.socket?.close(1008, message.code);
        this.callbacks.onStatus("closed");
      }
    } catch (error: unknown) {
      this.callbacks.onError(`サーバーメッセージを検証できませんでした: ${errorMessage(error)}`);
    }
  }

  private sendReliable(intent: ReliableIntent): void {
    const command = {
      protocolVersion: PROTOCOL_VERSION,
      actionId: crypto.randomUUID(),
      ...intent,
    } satisfies PendingCommand;
    if (!this.pendingCommands.add(command)) {
      this.callbacks.onError("未確認の操作が多すぎます。再接続を待ってください。");
      return;
    }
    this.transmitPending(command);
  }

  private transmitPending(command: PendingCommand): void {
    if (!this.welcomed) {
      return;
    }
    this.sendEphemeral(command);
  }

  private resendPendingCommands(): void {
    for (const command of this.pendingCommands.replay()) {
      this.transmitPending(command);
    }
  }

  private requestSnapshot(): void {
    if (this.syncRequested) {
      return;
    }
    this.syncRequested = true;
    this.sendEphemeral({
      protocolVersion: PROTOCOL_VERSION,
      type: "sync_request",
      actionId: crypto.randomUUID(),
      lastStateRevision: this.lastStateRevision,
    });
  }

  private sendEphemeral(message: ClientMessage): void {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(message));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.disposed) {
      return;
    }
    this.reconnectAttempt += 1;
    const delay = Math.min(5_000, 500 * 2 ** Math.min(this.reconnectAttempt - 1, 4));
    this.callbacks.onStatus("reconnecting");
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket("reconnecting");
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      this.sendEphemeral({
        protocolVersion: PROTOCOL_VERSION,
        type: "ping",
        actionId: crypto.randomUUID(),
        clientTimeMs: Date.now(),
      });
    }, 15_000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopPing();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラー";
}

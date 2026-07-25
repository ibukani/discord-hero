import {
  PROTOCOL_VERSION,
  RoomTicketResponseSchema,
  parseServerMessage,
  type HeroClassIdDto,
  type ServerMessage,
} from "@discord-hero/protocol";
import { postJson } from "../api/http.js";
import type { PlatformSession } from "../platform/types.js";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

export interface RoomSocketCallbacks {
  readonly onStatus: (status: ConnectionStatus) => void;
  readonly onMessage: (message: ServerMessage) => void;
  readonly onError: (message: string) => void;
}

export class RoomSocket {
  private socket: WebSocket | null = null;
  private disposed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private lastServerSequence: number | null = null;
  private selectedClassId: HeroClassIdDto;

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
    this.send({ type: "set_ready", ready });
  }

  public selectClass(classId: HeroClassIdDto): void {
    this.selectedClassId = classId;
    this.send({ type: "select_class", classId });
  }

  public startMatch(): void {
    this.send({ type: "start_match" });
  }

  public castSkill(skillId: string): void {
    this.send({ type: "cast_skill", skillId });
  }

  public selectUpgrade(upgradeId: string): void {
    this.send({ type: "select_upgrade", upgradeId });
  }

  public close(): void {
    this.disposed = true;
    this.clearTimers();
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

      const host = window.location.host;
      const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socketUrl = `${scheme}//${host}/api/rooms/${encodeURIComponent(this.session.roomId)}/socket?ticket=${encodeURIComponent(ticket.ticket)}`;
      const socket = new WebSocket(socketUrl, ["discord-hero.v1"]);
      this.socket = socket;

      socket.addEventListener("open", () => {
        if (this.socket !== socket || this.disposed) {
          socket.close();
          return;
        }
        this.reconnectAttempt = 0;
        this.callbacks.onStatus("connected");
        this.send({
          type: "hello",
          classId: this.selectedClassId,
          lastServerSequence: this.lastServerSequence,
        });
        this.startPing();
      });

      socket.addEventListener("message", (event: MessageEvent<unknown>) => {
        this.handleIncoming(event.data);
      });

      socket.addEventListener("error", () => {
        this.callbacks.onError(`WebSocket接続エラー (${host})`);
      });

      socket.addEventListener("close", () => {
        if (this.socket === socket) {
          this.socket = null;
        }
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
      const parsedJson = JSON.parse(input) as unknown;
      const message = parseServerMessage(parsedJson);
      this.lastServerSequence = Math.max(this.lastServerSequence ?? 0, message.serverSequence);
      this.callbacks.onMessage(message);
    } catch (error: unknown) {
      this.callbacks.onError(`サーバーメッセージを検証できませんでした: ${errorMessage(error)}`);
    }
  }

  private send(
    intent:
      | {
          readonly type: "hello";
          readonly classId: HeroClassIdDto;
          readonly lastServerSequence: number | null;
        }
      | { readonly type: "set_ready"; readonly ready: boolean }
      | { readonly type: "select_class"; readonly classId: HeroClassIdDto }
      | { readonly type: "start_match" }
      | { readonly type: "cast_skill"; readonly skillId: string }
      | { readonly type: "select_upgrade"; readonly upgradeId: string }
      | { readonly type: "ping"; readonly clientTimeMs: number },
  ): void {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        actionId: crypto.randomUUID(),
        ...intent,
      }),
    );
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
      this.send({ type: "ping", clientTimeMs: Date.now() });
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
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const candidate = error as { message?: unknown; name?: unknown };
    if (typeof candidate.message === "string" && candidate.message.length > 0) {
      return candidate.message;
    }
    if (typeof candidate.name === "string" && candidate.name.length > 0) {
      return candidate.name;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "[object]";
    }
  }
  if (typeof error === "number" || typeof error === "boolean") {
    return String(error);
  }
  return "不明なエラー";
}

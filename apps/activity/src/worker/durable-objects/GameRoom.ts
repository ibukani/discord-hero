import { DurableObject } from "cloudflare:workers";
import { CURRENT_CONTENT } from "@discord-hero/content";
import {
  actionId,
  applyCommand,
  createGame,
  matchId,
  playerId,
  stepGame,
  type GameContent,
  type GameEvent,
  type GameState,
} from "@discord-hero/game-core";
import {
  ClientMessageSchema,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from "@discord-hero/protocol";
import { z } from "zod";
import { verifyRoomTicket } from "../auth/tokens.js";
import { assertRuntimeEnv, type RuntimeEnv } from "../env.js";
import { createLogger, normalizeError, type Logger } from "../observability/logger.js";
import { toClientSnapshot, toDomainEvent } from "./codec.js";
import {
  GAME_PROTOCOL,
  MAX_MESSAGES_PER_RATE_WINDOW,
  MAX_PLAYER_CONNECTIONS,
  MAX_ROOM_CONNECTIONS,
  MESSAGE_RATE_WINDOW_MS,
  countPlayerConnections,
  readConnectionAttachment,
  roomIdFromSocketUrl,
  ticketFromProtocols,
  type ConnectionAttachment,
} from "./room-connections.js";
import { toGameCommand } from "./room-commands.js";
import { RoomRepository, type RoomRecoveryFailure } from "./room-repository.js";

const TICK_MS = 100;
const BROADCAST_INTERVAL_MS = 200;
const CHECKPOINT_INTERVAL_MS = 15_000;
const MAX_SOCKET_MESSAGE_BYTES = 8 * 1024;
const ProtocolProbeSchema = z.object({
  protocolVersion: z.number().int(),
});

export class GameRoom extends DurableObject<RuntimeEnv> {
  private game: GameState | null = null;
  private content: GameContent | null = null;
  private stateRevision = 0;
  private roomId: string | null = null;
  private matchStartedAt: string | null = null;
  private recoveryFailure: RoomRecoveryFailure | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBroadcastAt = 0;
  private lastCheckpointAt = 0;
  private readonly logger: Logger;
  private readonly repository: RoomRepository;

  public constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    assertRuntimeEnv(env);
    super(ctx, env);
    this.logger = createLogger(env.APP_ENV);
    this.repository = new RoomRepository(ctx.storage, env.MATCH_RESULTS_QUEUE, this.logger);
    void this.ctx.blockConcurrencyWhile(async () => {
      const needsRewrite = await this.restore();
      this.restoreRoomIdentityFromConnections();
      if (needsRewrite) {
        await this.persistCheckpoint();
      }
      if (this.game !== null && this.recoveryFailure === null) {
        this.recoveryFailure = await this.repository.prepareCompletedMatch(
          this.game,
          this.matchStartedAt,
          this.roomId,
        );
      }
      if (this.game?.status === "running" && this.ctx.getWebSockets().length > 0) {
        this.scheduleTick();
      }
    });
  }

  public override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const requestedRoomId = roomIdFromSocketUrl(request.url);
    if (requestedRoomId === null) {
      return new Response("Invalid room path", { status: 400 });
    }

    const ticket = ticketFromProtocols(request.headers.get("sec-websocket-protocol"));
    if (ticket === null) {
      return new Response("Room ticket required", { status: 401 });
    }

    let claims;
    try {
      claims = await verifyRoomTicket(ticket, this.env.SESSION_SIGNING_SECRET);
    } catch (error: unknown) {
      const normalized = normalizeError(error);
      this.logger.warn({
        event: "room_socket_rejected",
        errorCode: normalized.name,
      });
      return new Response("Invalid room ticket", { status: 401 });
    }

    if (claims.roomId !== requestedRoomId) {
      return new Response("Room ticket mismatch", { status: 403 });
    }
    if (this.roomId !== null && this.roomId !== requestedRoomId) {
      return new Response("Room identity mismatch", { status: 409 });
    }
    if (this.recoveryFailure !== null) {
      return new Response("Room state recovery failed", { status: 503 });
    }

    const sockets = this.ctx.getWebSockets();
    if (sockets.length >= MAX_ROOM_CONNECTIONS) {
      return new Response("Room connection limit reached", { status: 429 });
    }
    if (countPlayerConnections(sockets, claims.sub) >= MAX_PLAYER_CONNECTIONS) {
      return new Response("Player connection limit reached", { status: 429 });
    }

    try {
      await this.repository.consumeTicketNonce(claims.nonce, claims.exp);
    } catch {
      return new Response("Invalid room ticket", { status: 401 });
    }
    this.roomId = claims.roomId;

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: ConnectionAttachment = {
      playerId: claims.sub,
      displayName: claims.displayName,
      roomId: claims.roomId,
      connectedAt: new Date().toISOString(),
      rateWindowStartedAtMs: Date.now(),
      messagesInWindow: 0,
      handshakeComplete: false,
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: {
        "sec-websocket-protocol": GAME_PROTOCOL,
      },
    });
  }

  public override async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = readConnectionAttachment(socket);
    if (attachment === null) {
      socket.close(1008, "Invalid connection state");
      return;
    }

    if (!this.consumeMessageBudget(socket, attachment)) {
      this.sendError(socket, "rate_limited", "Too many messages");
      return;
    }
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    if (new TextEncoder().encode(text).byteLength > MAX_SOCKET_MESSAGE_BYTES) {
      this.sendError(socket, "bad_request", "Message is too large");
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text) as unknown;
    } catch {
      this.sendError(socket, "bad_request", "Invalid JSON");
      return;
    }

    const protocolProbe = ProtocolProbeSchema.safeParse(parsedJson);
    if (protocolProbe.success && protocolProbe.data.protocolVersion !== PROTOCOL_VERSION) {
      this.sendError(socket, "unsupported_protocol", "Unsupported protocol version");
      return;
    }

    const parsed = ClientMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.sendError(socket, "bad_request", "Invalid protocol message");
      return;
    }

    await this.handleMessage(socket, attachment, parsed.data);
  }

  public override async webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void> {
    const attachment = readConnectionAttachment(socket);
    if (attachment !== null && !this.hasAnotherConnection(attachment.playerId, socket)) {
      await this.markPlayerDisconnected(attachment.playerId);
    }

    const remainingSockets = this.ctx
      .getWebSockets()
      .filter((candidate: WebSocket) => candidate !== socket);
    if (remainingSockets.length === 0) {
      this.stopTick();
      await this.persistCheckpoint();
    }

    this.logger.info({
      event: "room_socket_closed",
      details: { code, reasonLength: reason.length, wasClean },
    });
  }

  public override async webSocketError(socket: WebSocket, error: unknown): Promise<void> {
    const normalized = normalizeError(error);
    this.logger.warn({
      event: "room_socket_error",
      errorCode: normalized.name,
    });
    const attachment = readConnectionAttachment(socket);
    if (attachment !== null && !this.hasAnotherConnection(attachment.playerId, socket)) {
      await this.markPlayerDisconnected(attachment.playerId);
    }
  }

  public override async alarm(): Promise<void> {
    const result = await this.repository.handleAlarm(this.roomId);
    if (result === "invalid_completion_outbox") {
      this.recoveryFailure = result;
      return;
    }
    if (result !== "cleanup") {
      return;
    }

    this.stopTick();
    for (const socket of this.ctx.getWebSockets()) {
      socket.close(1001, "Completed room expired");
    }
    await this.repository.deleteCompletedRoom();
    this.game = null;
    this.content = null;
    this.roomId = null;
    this.matchStartedAt = null;
    this.stateRevision = 0;
  }

  private async handleMessage(
    socket: WebSocket,
    attachment: ConnectionAttachment,
    message: ClientMessage,
  ): Promise<void> {
    if (message.type === "ping") {
      this.send(socket, {
        protocolVersion: PROTOCOL_VERSION,
        type: "pong",
        stateRevision: this.stateRevision,
        serverTick: this.game?.tick ?? 0,
        clientTimeMs: message.clientTimeMs,
        serverTimeMs: Date.now(),
      });
      return;
    }

    if (message.type === "sync_request") {
      if (!attachment.handshakeComplete) {
        this.rejectCommand(socket, message.actionId, "handshake_required");
        return;
      }
      this.sendSnapshot(socket);
      this.sendAck(socket, message.actionId);
      return;
    }

    if (message.type !== "hello" && !attachment.handshakeComplete) {
      this.rejectCommand(socket, message.actionId, "handshake_required");
      return;
    }

    if (message.type === "hello" && !this.isCompatibleClient(message)) {
      this.sendError(socket, "unsupported_content", "Client content version is unsupported");
      socket.close(1008, "Unsupported content version");
      return;
    }

    const game = this.ensureGame(attachment.roomId);
    const result = applyCommand(game, toGameCommand(message, attachment), this.requireContent());
    if (!result.accepted) {
      this.rejectCommand(socket, message.actionId, result.errorCode ?? "invalid_command");
      return;
    }

    const stateChanged = result.state !== game;
    this.game = result.state;
    if (stateChanged) {
      this.stateRevision += 1;
    }
    if (result.events.some((event) => event.type === "match_started")) {
      this.matchStartedAt = new Date().toISOString();
    }
    if (message.type === "hello") {
      socket.serializeAttachment({ ...attachment, handshakeComplete: true });
    }

    await this.handlePostMutation(result.events, message.type !== "cast_skill");

    if (message.type === "hello") {
      this.sendWelcome(socket, attachment.playerId);
    }
    this.broadcastEvents(result.events);
    if (stateChanged) {
      this.broadcastSnapshot();
    }
    this.sendAck(socket, message.actionId);
  }

  private isCompatibleClient(message: Extract<ClientMessage, { readonly type: "hello" }>): boolean {
    const content = this.content ?? CURRENT_CONTENT;
    return (
      message.rulesetVersion === content.rulesetVersion &&
      message.contentVersion === content.version
    );
  }

  private ensureGame(roomId: string): GameState {
    if (this.game !== null) {
      return this.game;
    }
    const generatedMatchId = matchId(`match-${crypto.randomUUID()}`);
    this.content = CURRENT_CONTENT;
    this.game = createGame({
      matchId: generatedMatchId,
      seed: `${roomId}:${crypto.randomUUID()}`,
      content: this.content,
    });
    return this.game;
  }

  private requireContent(): GameContent {
    if (this.content === null) {
      throw new Error("Game content is not available");
    }
    return this.content;
  }

  private scheduleTick(): void {
    if (this.tickTimer !== null || this.game?.status !== "running") {
      return;
    }
    if (this.ctx.getWebSockets().length === 0) {
      return;
    }

    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      this.ctx.waitUntil(this.runTick());
    }, TICK_MS);
  }

  private async runTick(): Promise<void> {
    const game = this.game;
    if (game?.status !== "running") {
      return;
    }

    const startedAt = performance.now();
    const result = stepGame(game, TICK_MS, this.requireContent());
    this.game = result.state;
    this.stateRevision += 1;
    const now = Date.now();

    await this.handlePostMutation(result.events, false);

    if (result.events.length > 0) {
      this.broadcastEvents(result.events);
    }
    if (now - this.lastBroadcastAt >= BROADCAST_INTERVAL_MS) {
      this.broadcastSnapshot();
      this.lastBroadcastAt = now;
    }
    if (now - this.lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) {
      await this.persistCheckpoint();
      this.lastCheckpointAt = now;
    }

    const durationMs = performance.now() - startedAt;
    if (durationMs >= TICK_MS) {
      this.logger.warn({
        event: "slow_game_tick",
        matchId: result.state.matchId,
        serverTick: result.state.tick,
        durationMs,
      });
    }

    this.scheduleTick();
  }

  private async handlePostMutation(
    events: readonly GameEvent[],
    forceCheckpoint: boolean,
  ): Promise<void> {
    const game = this.game;
    if (game === null) {
      return;
    }

    const shouldCheckpoint =
      forceCheckpoint ||
      events.some(
        (event) =>
          event.type === "player_joined" ||
          event.type === "player_reconnected" ||
          event.type === "player_disconnected" ||
          event.type === "match_started" ||
          event.type === "upgrade_selected" ||
          event.type === "wave_spawned" ||
          event.type === "match_ended",
      );
    if (shouldCheckpoint) {
      await this.persistCheckpoint();
    }

    if (events.some((event) => event.type === "match_ended")) {
      this.stopTick();
      this.recoveryFailure = await this.repository.prepareCompletedMatch(
        game,
        this.matchStartedAt,
        this.roomId,
      );
      return;
    }

    if (game.status === "running") {
      this.scheduleTick();
    }
  }

  private sendWelcome(socket: WebSocket, currentPlayerId: string): void {
    const game = this.game;
    if (game === null || this.roomId === null) {
      return;
    }
    this.send(socket, {
      protocolVersion: PROTOCOL_VERSION,
      type: "welcome",
      stateRevision: this.stateRevision,
      serverTick: game.tick,
      playerId: currentPlayerId,
      roomId: this.roomId,
      snapshot: toClientSnapshot(game),
    });
  }

  private sendSnapshot(socket: WebSocket): void {
    const game = this.game;
    if (game === null) {
      this.sendError(socket, "not_found", "Room state is not initialized");
      return;
    }
    this.send(socket, {
      protocolVersion: PROTOCOL_VERSION,
      type: "snapshot",
      stateRevision: this.stateRevision,
      serverTick: game.tick,
      snapshot: toClientSnapshot(game),
    });
  }

  private broadcastSnapshot(): void {
    const game = this.game;
    if (game === null) {
      return;
    }
    this.broadcast({
      protocolVersion: PROTOCOL_VERSION,
      type: "snapshot",
      stateRevision: this.stateRevision,
      serverTick: game.tick,
      snapshot: toClientSnapshot(game),
    });
  }

  private broadcastEvents(events: readonly GameEvent[]): void {
    const game = this.game;
    if (game === null || events.length === 0) {
      return;
    }
    this.broadcast({
      protocolVersion: PROTOCOL_VERSION,
      type: "events",
      stateRevision: this.stateRevision,
      serverTick: game.tick,
      events: events.map(toDomainEvent),
    });
  }

  private broadcast(message: ServerMessage): void {
    const serialized = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(serialized);
      } catch (error: unknown) {
        const normalized = normalizeError(error);
        this.logger.warn({
          event: "room_broadcast_failed",
          errorCode: normalized.name,
          details: { message: normalized.message },
        });
      }
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    socket.send(JSON.stringify(message));
  }

  private sendAck(socket: WebSocket, commandActionId: string): void {
    this.send(socket, {
      protocolVersion: PROTOCOL_VERSION,
      type: "command_ack",
      stateRevision: this.stateRevision,
      serverTick: this.game?.tick ?? 0,
      actionId: commandActionId,
    });
  }

  private rejectCommand(socket: WebSocket, commandActionId: string, reason: string): void {
    this.send(socket, {
      protocolVersion: PROTOCOL_VERSION,
      type: "command_rejected",
      stateRevision: this.stateRevision,
      serverTick: this.game?.tick ?? 0,
      actionId: commandActionId,
      reason,
    });
  }

  private sendError(socket: WebSocket, code: ErrorCode, message: string): void {
    this.send(socket, {
      protocolVersion: PROTOCOL_VERSION,
      type: "error",
      stateRevision: this.stateRevision,
      serverTick: this.game?.tick ?? 0,
      code,
      message,
    });
  }

  private restoreRoomIdentityFromConnections(): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = readConnectionAttachment(socket);
      if (attachment === null) {
        socket.close(1008, "Invalid connection state");
        continue;
      }
      if (this.roomId === null) {
        this.roomId = attachment.roomId;
        continue;
      }
      if (this.roomId !== attachment.roomId) {
        this.logger.error({
          event: "room_connection_identity_mismatch",
          errorCode: "invalid_connection_state",
        });
        socket.close(1008, "Invalid connection state");
      }
    }
  }

  private consumeMessageBudget(socket: WebSocket, attachment: ConnectionAttachment): boolean {
    const now = Date.now();
    const windowExpired = now - attachment.rateWindowStartedAtMs >= MESSAGE_RATE_WINDOW_MS;
    const nextAttachment: ConnectionAttachment = windowExpired
      ? {
          ...attachment,
          rateWindowStartedAtMs: now,
          messagesInWindow: 1,
        }
      : {
          ...attachment,
          messagesInWindow: attachment.messagesInWindow + 1,
        };
    socket.serializeAttachment(nextAttachment);
    return nextAttachment.messagesInWindow <= MAX_MESSAGES_PER_RATE_WINDOW;
  }

  private hasAnotherConnection(playerIdentifier: string, closingSocket: WebSocket): boolean {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === closingSocket) {
        continue;
      }
      if (readConnectionAttachment(socket)?.playerId === playerIdentifier) {
        return true;
      }
    }
    return false;
  }

  private async markPlayerDisconnected(playerIdentifier: string): Promise<void> {
    const game = this.game;
    if (game?.players[playerIdentifier] === undefined || this.content === null) {
      return;
    }
    const result = applyCommand(
      game,
      {
        type: "disconnect_player",
        actionId: actionId(`disconnect-${crypto.randomUUID()}`),
        playerId: playerId(playerIdentifier),
      },
      this.content,
    );
    if (!result.accepted) {
      return;
    }
    this.game = result.state;
    this.stateRevision += 1;
    await this.persistCheckpoint();
    this.broadcastEvents(result.events);
    this.broadcastSnapshot();
  }

  private stopTick(): void {
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private async restore(): Promise<boolean> {
    const restored = await this.repository.restore();
    if (restored.status === "empty") {
      return false;
    }
    if (restored.status === "failed") {
      this.recoveryFailure = restored.reason;
      return false;
    }

    this.game = restored.game;
    this.content = restored.content;
    this.stateRevision = restored.stateRevision;
    this.roomId = restored.roomId;
    this.matchStartedAt = restored.matchStartedAt;
    this.lastCheckpointAt = Date.now();
    return restored.needsRewrite;
  }

  private async persistCheckpoint(): Promise<void> {
    const game = this.game;
    if (game === null) {
      return;
    }
    await this.repository.persistCheckpoint({
      game,
      stateRevision: this.stateRevision,
      roomId: this.roomId,
      matchStartedAt: this.matchStartedAt,
    });
  }
}

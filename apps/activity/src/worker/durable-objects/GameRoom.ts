import { DurableObject } from "cloudflare:workers";
import { DEFAULT_CONTENT } from "@discord-hero/content";
import {
  actionId,
  applyCommand,
  createGame,
  matchId,
  playerId,
  stepGame,
  type GameCommand,
  type GameEvent,
  type GameState,
} from "@discord-hero/game-core";
import {
  ClientMessageSchema,
  PersistedRoomSnapshotSchema,
  PROTOCOL_VERSION,
  RoomIdSchema,
  type ClientMessage,
  type MatchFinishedEvent,
  type PersistedRoomSnapshot,
  type ServerMessage,
} from "@discord-hero/protocol";
import { z } from "zod";
import { verifyRoomTicket } from "../auth/tokens.js";
import { assertRuntimeEnv, type RuntimeEnv } from "../env.js";
import {
  createLogger,
  hashIdentifier,
  normalizeError,
  type Logger,
} from "../observability/logger.js";
import {
  fromStoredGameState,
  toClientSnapshot,
  toDomainEvent,
  toStoredGameState,
} from "./codec.js";

const TICK_MS = 100;
const BROADCAST_INTERVAL_MS = 200;
const CHECKPOINT_INTERVAL_MS = 15_000;
const MAX_SOCKET_MESSAGE_BYTES = 8 * 1024;
const SNAPSHOT_STORAGE_KEY = "room-snapshot";
const USED_TICKETS_STORAGE_KEY = "used-room-tickets";
const RESULT_QUEUED_PREFIX = "result-queued:";
const GAME_PROTOCOL = "discord-hero.v1";
const AUTH_PROTOCOL_PREFIX = "auth.";

const ConnectionAttachmentSchema = z.object({
  playerId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(48),
  roomId: RoomIdSchema,
  connectedAt: z.iso.datetime(),
  rateWindowStartedAtMs: z.number().int().nonnegative(),
  messagesInWindow: z.number().int().nonnegative(),
});

type ConnectionAttachment = z.infer<typeof ConnectionAttachmentSchema>;

const UsedTicketsSchema = z.record(z.string(), z.number().int().positive());
const ProtocolProbeSchema = z.object({
  protocolVersion: z.number().int(),
});

const MESSAGE_RATE_WINDOW_MS = 10_000;
const MAX_MESSAGES_PER_RATE_WINDOW = 40;

export class GameRoom extends DurableObject<RuntimeEnv> {
  private game: GameState | null = null;
  private serverSequence = 0;
  private roomId: string | null = null;
  private matchStartedAt: string | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBroadcastAt = 0;
  private lastCheckpointAt = 0;
  private readonly logger: Logger;

  public constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    assertRuntimeEnv(env);
    super(ctx, env);
    this.logger = createLogger(env.APP_ENV);
    void this.ctx.blockConcurrencyWhile(async () => {
      await this.restore();
      this.restoreRoomIdentityFromConnections();
      if (this.game?.status === "running" && this.ctx.getWebSockets().length > 0) {
        this.scheduleTick();
      }
    });
  }

  public override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const requestedRoomId = roomIdFromUrl(request.url);
    if (requestedRoomId === null) {
      return new Response("Invalid room path", { status: 400 });
    }

    const ticket = ticketFromRequest(request);
    if (ticket === null) {
      return new Response("Room ticket required", { status: 401 });
    }

    try {
      const claims = await verifyRoomTicket(ticket, this.env.SESSION_SIGNING_SECRET);
      if (claims.roomId !== requestedRoomId) {
        return new Response("Room ticket mismatch", { status: 403 });
      }
      await this.consumeTicketNonce(claims.nonce, claims.exp);
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
    } catch (error: unknown) {
      const normalized = normalizeError(error);
      this.logger.warn({
        event: "room_socket_rejected",
        errorCode: normalized.name,
      });
      return new Response("Invalid room ticket", { status: 401 });
    }
  }

  public override async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = this.readAttachment(socket);
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
    const attachment = this.readAttachment(socket);
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
    const attachment = this.readAttachment(socket);
    if (attachment !== null && !this.hasAnotherConnection(attachment.playerId, socket)) {
      await this.markPlayerDisconnected(attachment.playerId);
    }
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
        serverSequence: this.nextSequence(),
        serverTick: this.game?.tick ?? 0,
        clientTimeMs: message.clientTimeMs,
        serverTimeMs: Date.now(),
      });
      return;
    }

    const game = this.ensureGame(attachment.roomId);
    const command = this.toCommand(message, attachment);
    const result = applyCommand(game, command, DEFAULT_CONTENT);
    if (!result.accepted) {
      this.send(socket, {
        protocolVersion: PROTOCOL_VERSION,
        type: "command_rejected",
        serverSequence: this.nextSequence(),
        serverTick: game.tick,
        actionId: message.actionId,
        reason: result.errorCode ?? "invalid_command",
      });
      return;
    }

    this.game = result.state;
    if (result.events.some((event) => event.type === "match_started")) {
      this.matchStartedAt = new Date().toISOString();
    }

    if (message.type === "hello") {
      this.sendWelcome(socket, attachment.playerId);
    }

    this.broadcastEvents(result.events);
    this.broadcastSnapshot();
    await this.handlePostMutation(result.events);
  }

  private ensureGame(roomId: string): GameState {
    if (this.game !== null) {
      return this.game;
    }
    const generatedMatchId = matchId(`match-${crypto.randomUUID()}`);
    this.game = createGame({
      matchId: generatedMatchId,
      seed: `${roomId}:${crypto.randomUUID()}`,
      content: DEFAULT_CONTENT,
    });
    return this.game;
  }

  private toCommand(
    message: Exclude<ClientMessage, { readonly type: "ping" }>,
    attachment: ConnectionAttachment,
  ): GameCommand {
    const actorId = playerId(attachment.playerId);
    const commandActionId = actionId(message.actionId);

    switch (message.type) {
      case "hello":
        return {
          type: "join_player",
          actionId: commandActionId,
          playerId: actorId,
          displayName: attachment.displayName,
          classId: message.classId,
        };
      case "set_ready":
        return {
          type: "set_ready",
          actionId: commandActionId,
          playerId: actorId,
          ready: message.ready,
        };
      case "select_class":
        return {
          type: "select_class",
          actionId: commandActionId,
          playerId: actorId,
          classId: message.classId,
        };
      case "start_match":
        return {
          type: "start_match",
          actionId: commandActionId,
          playerId: actorId,
        };
      case "cast_skill":
        return {
          type: "cast_skill",
          actionId: commandActionId,
          playerId: actorId,
          skillId: message.skillId,
        };
      case "select_upgrade":
        return {
          type: "select_upgrade",
          actionId: commandActionId,
          playerId: actorId,
          upgradeId: message.upgradeId,
        };
    }
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
    const result = stepGame(game, TICK_MS, DEFAULT_CONTENT);
    this.game = result.state;
    const now = Date.now();

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

    await this.handlePostMutation(result.events);

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

  private async handlePostMutation(events: readonly GameEvent[]): Promise<void> {
    const game = this.game;
    if (game === null) {
      return;
    }

    const shouldCheckpoint = events.some(
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

    const matchEnded = events.some((event) => event.type === "match_ended");
    if (matchEnded) {
      this.stopTick();
      await this.queueMatchResult(game);
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
      serverSequence: this.nextSequence(),
      serverTick: game.tick,
      playerId: currentPlayerId,
      roomId: this.roomId,
      snapshot: toClientSnapshot(game),
    });
  }

  private broadcastSnapshot(): void {
    const game = this.game;
    if (game === null) {
      return;
    }
    const message: ServerMessage = {
      protocolVersion: PROTOCOL_VERSION,
      type: "snapshot",
      serverSequence: this.nextSequence(),
      serverTick: game.tick,
      snapshot: toClientSnapshot(game),
    };
    this.broadcast(message);
  }

  private broadcastEvents(events: readonly GameEvent[]): void {
    const game = this.game;
    if (game === null || events.length === 0) {
      return;
    }
    const message: ServerMessage = {
      protocolVersion: PROTOCOL_VERSION,
      type: "events",
      serverSequence: this.nextSequence(),
      serverTick: game.tick,
      events: events.map(toDomainEvent),
    };
    this.broadcast(message);
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

  private sendError(
    socket: WebSocket,
    code:
      | "bad_request"
      | "unauthorized"
      | "forbidden"
      | "not_found"
      | "room_full"
      | "rate_limited"
      | "unsupported_protocol"
      | "invalid_command"
      | "internal_error",
    message: string,
  ): void {
    this.send(socket, {
      protocolVersion: PROTOCOL_VERSION,
      type: "error",
      serverSequence: this.nextSequence(),
      serverTick: this.game?.tick ?? 0,
      code,
      message,
    });
  }

  private readAttachment(socket: WebSocket): ConnectionAttachment | null {
    const parsed = ConnectionAttachmentSchema.safeParse(socket.deserializeAttachment());
    return parsed.success ? parsed.data : null;
  }

  private restoreRoomIdentityFromConnections(): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.readAttachment(socket);
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
      const attachment = this.readAttachment(socket);
      if (attachment?.playerId === playerIdentifier) {
        return true;
      }
    }
    return false;
  }

  private async markPlayerDisconnected(playerIdentifier: string): Promise<void> {
    const game = this.game;
    if (game?.players[playerIdentifier] === undefined) {
      return;
    }
    const result = applyCommand(
      game,
      {
        type: "disconnect_player",
        actionId: actionId(`disconnect-${crypto.randomUUID()}`),
        playerId: playerId(playerIdentifier),
      },
      DEFAULT_CONTENT,
    );
    if (!result.accepted) {
      return;
    }
    this.game = result.state;
    this.broadcastEvents(result.events);
    this.broadcastSnapshot();
    await this.persistCheckpoint();
  }

  private stopTick(): void {
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private nextSequence(): number {
    this.serverSequence += 1;
    return this.serverSequence;
  }

  private async restore(): Promise<void> {
    const stored = await this.ctx.storage.get(SNAPSHOT_STORAGE_KEY);
    if (stored === undefined) {
      return;
    }
    const parsed = PersistedRoomSnapshotSchema.safeParse(stored);
    if (!parsed.success) {
      this.logger.error({
        event: "room_snapshot_rejected",
        errorCode: "invalid_persisted_snapshot",
      });
      return;
    }
    this.game = fromStoredGameState(parsed.data.game);
    this.serverSequence = parsed.data.serverSequence;
    this.matchStartedAt = parsed.data.matchStartedAt;
    this.lastCheckpointAt = Date.now();
  }

  private async persistCheckpoint(): Promise<void> {
    const game = this.game;
    if (game === null) {
      return;
    }
    const snapshot: PersistedRoomSnapshot = {
      storageSchemaVersion: 1,
      savedAt: new Date().toISOString(),
      serverSequence: this.serverSequence,
      matchStartedAt: this.matchStartedAt,
      game: toStoredGameState(game),
    };
    await this.ctx.storage.put(SNAPSHOT_STORAGE_KEY, snapshot);
  }

  private async consumeTicketNonce(nonce: string, expiration: number): Promise<void> {
    const stored = await this.ctx.storage.get(USED_TICKETS_STORAGE_KEY);
    const parsed = UsedTicketsSchema.safeParse(stored ?? {});
    const usedTickets: Record<string, number> = parsed.success ? { ...parsed.data } : {};
    const now = Math.floor(Date.now() / 1_000);

    for (const [storedNonce, expiresAt] of Object.entries(usedTickets)) {
      if (expiresAt <= now) {
        Reflect.deleteProperty(usedTickets, storedNonce);
      }
    }
    if (usedTickets[nonce] !== undefined) {
      throw new Error("Room ticket was already used");
    }
    usedTickets[nonce] = expiration;
    await this.ctx.storage.put(USED_TICKETS_STORAGE_KEY, usedTickets);
  }

  private async queueMatchResult(game: GameState): Promise<void> {
    if (game.result === null) {
      return;
    }
    const resultKey = `${RESULT_QUEUED_PREFIX}${game.matchId}`;
    const alreadyQueued = await this.ctx.storage.get<boolean>(resultKey);
    if (alreadyQueued === true) {
      return;
    }

    const endedAt = new Date().toISOString();
    const event: MatchFinishedEvent = {
      eventId: `${game.matchId}:finished`,
      matchId: game.matchId,
      rulesetVersion: game.rulesetVersion,
      contentVersion: game.contentVersion,
      seed: game.seed,
      startedAt: this.matchStartedAt ?? new Date(Date.now() - game.elapsedMs).toISOString(),
      endedAt,
      result: { ...game.result },
      players: Object.values(game.players).map((player) => ({
        playerId: player.id,
        displayName: player.displayName,
        classId: player.classId,
        score: player.score,
        stats: { ...player.stats },
      })),
    };

    await this.env.MATCH_RESULTS_QUEUE.send(event);
    await this.ctx.storage.put(resultKey, true);
    const roomIdHash = this.roomId === null ? null : await hashIdentifier(this.roomId);
    if (roomIdHash === null) {
      this.logger.info({
        event: "match_result_queued",
        matchId: game.matchId,
      });
    } else {
      this.logger.info({
        event: "match_result_queued",
        roomIdHash,
        matchId: game.matchId,
      });
    }
  }
}

function roomIdFromUrl(urlValue: string): string | null {
  const path = new URL(urlValue).pathname;
  const match = /^\/api\/rooms\/([^/]+)\/socket$/u.exec(path);
  if (match?.[1] === undefined) {
    return null;
  }
  try {
    return RoomIdSchema.parse(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function ticketFromProtocols(header: string | null): string | null {
  if (header === null) {
    return null;
  }
  const protocols = header.split(",").map((protocol) => protocol.trim());
  if (!protocols.includes(GAME_PROTOCOL)) {
    return null;
  }
  const authProtocol = protocols.find((protocol) => protocol.startsWith(AUTH_PROTOCOL_PREFIX));
  return authProtocol?.slice(AUTH_PROTOCOL_PREFIX.length) ?? null;
}

function ticketFromRequest(request: Request): string | null {
  const url = new URL(request.url);
  const queryTicket = url.searchParams.get("ticket");
  if (queryTicket !== null && queryTicket.length > 0) {
    return queryTicket;
  }
  return ticketFromProtocols(request.headers.get("sec-websocket-protocol"));
}

import { resolveGameContent } from "@discord-hero/content";
import type { GameContent, GameState } from "@discord-hero/game-core";
import {
  parsePersistedRoomSnapshot,
  type MatchFinishedEvent,
  type PersistedRoomSnapshot,
} from "@discord-hero/protocol";
import { z } from "zod";
import { hashIdentifier, normalizeError, type Logger } from "../observability/logger.js";
import {
  COMPLETED_ROOM_RETENTION_MS,
  COMPLETION_OUTBOX_STORAGE_KEY,
  OUTBOX_RETRY_DELAY_MS,
  RESULT_QUEUED_PREFIX,
  ROOM_LIFECYCLE_STORAGE_KEY,
  RoomLifecycleSchema,
  SNAPSHOT_STORAGE_KEY,
  createMatchFinishedEvent,
  parseCompletionOutbox,
} from "./completion-outbox.js";
import { fromStoredGameState, toStoredGameState } from "./codec.js";

const USED_TICKETS_STORAGE_KEY = "used-room-tickets";
const UsedTicketsSchema = z.record(z.string(), z.number().int().positive());

export type RoomRecoveryFailure =
  | "invalid_snapshot"
  | "unsupported_storage_version"
  | "unsupported_content"
  | "invalid_completion_outbox";

export type RoomRestoreResult =
  | { readonly status: "empty" }
  | { readonly status: "failed"; readonly reason: RoomRecoveryFailure }
  | {
      readonly status: "restored";
      readonly game: GameState;
      readonly content: GameContent;
      readonly stateRevision: number;
      readonly roomId: string | null;
      readonly matchStartedAt: string | null;
      readonly needsRewrite: boolean;
    };

export interface RoomCheckpoint {
  readonly game: GameState;
  readonly stateRevision: number;
  readonly roomId: string | null;
  readonly matchStartedAt: string | null;
}

type AlarmResult = "retained" | "cleanup" | RoomRecoveryFailure;
type DeliveryResult = "delivered" | "retry" | "invalid_completion_outbox";

export interface RoomStorage {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
  deleteAll(): Promise<void>;
}

export interface MatchResultQueue {
  send(message: MatchFinishedEvent): Promise<unknown>;
}

export class RoomRepository {
  public constructor(
    private readonly storage: RoomStorage,
    private readonly queue: MatchResultQueue,
    private readonly logger: Logger,
  ) {}

  public async restore(): Promise<RoomRestoreResult> {
    const stored = await this.storage.get(SNAPSHOT_STORAGE_KEY);
    if (stored === undefined) {
      return { status: "empty" };
    }
    const parsed = parsePersistedRoomSnapshot(stored);
    if (!parsed.success) {
      this.logger.error({
        event: "room_snapshot_rejected",
        errorCode: parsed.reason,
      });
      return { status: "failed", reason: parsed.reason };
    }

    const content = resolveGameContent(
      parsed.data.game.rulesetVersion,
      parsed.data.game.contentVersion,
    );
    if (content === null) {
      this.logger.error({
        event: "room_snapshot_rejected",
        errorCode: "unsupported_content",
        matchId: parsed.data.game.matchId,
      });
      return { status: "failed", reason: "unsupported_content" };
    }

    return {
      status: "restored",
      game: fromStoredGameState(parsed.data.game),
      content,
      stateRevision: parsed.data.stateRevision,
      roomId: parsed.data.roomId,
      matchStartedAt: parsed.data.matchStartedAt,
      needsRewrite: parsed.migratedFromVersion !== null,
    };
  }

  public async persistCheckpoint(checkpoint: RoomCheckpoint): Promise<void> {
    const snapshot: PersistedRoomSnapshot = {
      storageSchemaVersion: 2,
      savedAt: new Date().toISOString(),
      stateRevision: checkpoint.stateRevision,
      roomId: checkpoint.roomId,
      matchStartedAt: checkpoint.matchStartedAt,
      game: toStoredGameState(checkpoint.game),
    };
    await this.storage.put(SNAPSHOT_STORAGE_KEY, snapshot);
  }

  public async consumeTicketNonce(nonce: string, expiration: number): Promise<void> {
    const stored = await this.storage.get(USED_TICKETS_STORAGE_KEY);
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
    await this.storage.put(USED_TICKETS_STORAGE_KEY, usedTickets);
  }

  public async prepareCompletedMatch(
    game: GameState,
    matchStartedAt: string | null,
    roomId: string | null,
  ): Promise<RoomRecoveryFailure | null> {
    if (game.status !== "victory" && game.status !== "defeat" && game.status !== "return") {
      return null;
    }
    const resultKey = `${RESULT_QUEUED_PREFIX}${game.matchId}`;
    if ((await this.storage.get(resultKey)) === true) {
      await this.ensureCleanupScheduled();
      return null;
    }

    await this.ensureCompletionOutbox(game, matchStartedAt);
    const outbox = await this.storage.get(COMPLETION_OUTBOX_STORAGE_KEY);
    if (outbox === undefined) {
      return null;
    }
    const delivery = await this.tryDeliverCompletion(outbox, roomId);
    return delivery === "invalid_completion_outbox" ? delivery : null;
  }

  public async handleAlarm(roomId: string | null): Promise<AlarmResult> {
    const outbox = await this.storage.get(COMPLETION_OUTBOX_STORAGE_KEY);
    if (outbox !== undefined) {
      const delivery = await this.tryDeliverCompletion(outbox, roomId);
      if (delivery === "retry") {
        return "retained";
      }
      if (delivery === "invalid_completion_outbox") {
        return delivery;
      }
    }

    const lifecycle = RoomLifecycleSchema.safeParse(
      await this.storage.get(ROOM_LIFECYCLE_STORAGE_KEY),
    );
    if (!lifecycle.success) {
      return "retained";
    }
    if (lifecycle.data.cleanupAtMs > Date.now()) {
      await this.storage.setAlarm(lifecycle.data.cleanupAtMs);
      return "retained";
    }
    return "cleanup";
  }

  public async deleteCompletedRoom(): Promise<void> {
    await this.storage.deleteAlarm();
    await this.storage.deleteAll();
  }

  private async ensureCompletionOutbox(
    game: GameState,
    matchStartedAt: string | null,
  ): Promise<void> {
    if (game.result === null) {
      return;
    }
    if ((await this.storage.get(COMPLETION_OUTBOX_STORAGE_KEY)) !== undefined) {
      await this.storage.setAlarm(Date.now());
      return;
    }

    const endedAt = new Date().toISOString();
    const startedAt = matchStartedAt ?? new Date(Date.now() - game.elapsedMs).toISOString();
    const event = createMatchFinishedEvent(game, startedAt, endedAt);
    if (event === null) {
      return;
    }
    await this.storage.put(COMPLETION_OUTBOX_STORAGE_KEY, event);
    await this.storage.setAlarm(Date.now());
  }

  private async tryDeliverCompletion(
    input: unknown,
    roomId: string | null,
  ): Promise<DeliveryResult> {
    const event = parseCompletionOutbox(input);
    if (event === null) {
      this.logger.error({
        event: "completion_outbox_rejected",
        errorCode: "invalid_completion_outbox",
      });
      return "invalid_completion_outbox";
    }

    try {
      await this.queue.send(event);
      await this.storage.put(`${RESULT_QUEUED_PREFIX}${event.matchId}`, true);
      await this.storage.delete(COMPLETION_OUTBOX_STORAGE_KEY);
      await this.ensureCleanupScheduled();
      const roomIdHash = roomId === null ? null : await hashIdentifier(roomId);
      if (roomIdHash === null) {
        this.logger.info({
          event: "match_result_queued",
          matchId: event.matchId,
        });
      } else {
        this.logger.info({
          event: "match_result_queued",
          roomIdHash,
          matchId: event.matchId,
        });
      }
      return "delivered";
    } catch (error: unknown) {
      const normalized = normalizeError(error);
      this.logger.warn({
        event: "match_result_queue_retry_scheduled",
        errorCode: normalized.name,
        matchId: event.matchId,
      });
      await this.storage.setAlarm(Date.now() + OUTBOX_RETRY_DELAY_MS);
      return "retry";
    }
  }

  private async ensureCleanupScheduled(): Promise<void> {
    const existing = RoomLifecycleSchema.safeParse(
      await this.storage.get(ROOM_LIFECYCLE_STORAGE_KEY),
    );
    const lifecycle = existing.success
      ? existing.data
      : { cleanupAtMs: Date.now() + COMPLETED_ROOM_RETENTION_MS };
    if (!existing.success) {
      await this.storage.put(ROOM_LIFECYCLE_STORAGE_KEY, lifecycle);
    }
    await this.storage.setAlarm(lifecycle.cleanupAtMs);
  }
}

import type { GameState } from "@discord-hero/game-core";
import { MatchFinishedEventSchema, type MatchFinishedEvent } from "@discord-hero/protocol";
import { z } from "zod";

export const SNAPSHOT_STORAGE_KEY = "room-snapshot";
export const COMPLETION_OUTBOX_STORAGE_KEY = "completion-outbox";
export const ROOM_LIFECYCLE_STORAGE_KEY = "room-lifecycle";
export const RESULT_QUEUED_PREFIX = "result-queued:";
export const OUTBOX_RETRY_DELAY_MS = 60_000;
export const COMPLETED_ROOM_RETENTION_MS = 24 * 60 * 60 * 1_000;

export const RoomLifecycleSchema = z.object({
  cleanupAtMs: z.number().int().nonnegative(),
});

export type RoomLifecycle = z.infer<typeof RoomLifecycleSchema>;

export function createMatchFinishedEvent(
  game: GameState,
  startedAt: string,
  endedAt: string,
): MatchFinishedEvent | null {
  if (game.result === null) {
    return null;
  }
  return MatchFinishedEventSchema.parse({
    eventId: `${game.matchId}:finished`,
    matchId: game.matchId,
    rulesetVersion: game.rulesetVersion,
    contentVersion: game.contentVersion,
    seed: game.seed,
    startedAt,
    endedAt,
    result: { ...game.result },
    players: Object.values(game.players).map((player) => ({
      playerId: player.id,
      displayName: player.displayName,
      classId: player.classId,
      score: player.score,
      stats: { ...player.stats },
    })),
  });
}

export function parseCompletionOutbox(input: unknown): MatchFinishedEvent | null {
  const parsed = MatchFinishedEventSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

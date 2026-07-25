import { env } from "cloudflare:workers";
import type { MatchFinishedEvent } from "@discord-hero/protocol";
import { describe, expect, it } from "vitest";
import { persistMatchResult } from "../src/worker/persistence/match-result-repository.js";

const EVENT: MatchFinishedEvent = {
  eventId: "match-integration:finished",
  matchId: "match-integration",
  rulesetVersion: "1.0.0",
  contentVersion: "2026.07.1",
  seed: "integration-seed",
  startedAt: "2026-07-25T00:00:00.000Z",
  endedAt: "2026-07-25T00:10:00.000Z",
  result: {
    outcome: "victory",
    durationMs: 600_000,
    completedAtTick: 6_000,
  },
  players: [
    {
      playerId: "player-one",
      displayName: "Player One",
      classId: "guardian",
      score: 500,
      stats: {
        damageDealt: 1_000,
        healingDone: 0,
        damageTaken: 200,
        enemiesDefeated: 10,
      },
    },
  ],
};

describe("match result persistence", () => {
  it("stores a result once and treats a retry as a duplicate", async () => {
    await expect(persistMatchResult(env.DB, EVENT)).resolves.toBe("stored");
    await expect(persistMatchResult(env.DB, EVENT)).resolves.toBe("duplicate");

    const matchCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM match_results WHERE match_id = ?1",
    )
      .bind(EVENT.matchId)
      .first<{ count: number }>();
    const eventCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM processed_events WHERE event_id = ?1",
    )
      .bind(EVENT.eventId)
      .first<{ count: number }>();

    expect(matchCount?.count).toBe(1);
    expect(eventCount?.count).toBe(1);
  });
});

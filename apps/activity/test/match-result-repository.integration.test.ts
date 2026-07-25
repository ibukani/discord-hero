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
    rewards: { "player-one": { currency: 250, experience: 125 } },
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

    const progress = await env.DB.prepare(
      "SELECT account_level, experience, game_currency, version FROM player_progress WHERE player_id = ?1",
    )
      .bind("player-one")
      .first<{
        account_level: number;
        experience: number;
        game_currency: number;
        version: number;
      }>();
    expect(progress).toEqual({
      account_level: 2,
      experience: 125,
      game_currency: 250,
      version: 2,
    });

    const storedResult = await env.DB.prepare(
      "SELECT rewards_json FROM match_results WHERE match_id = ?1",
    )
      .bind(EVENT.matchId)
      .first<{ rewards_json: string }>();
    const storedPlayer = await env.DB.prepare(
      "SELECT rewards_json FROM match_players WHERE match_id = ?1 AND player_id = ?2",
    )
      .bind(EVENT.matchId, "player-one")
      .first<{ rewards_json: string }>();
    expect(storedResult?.rewards_json).toBe(JSON.stringify(EVENT.result.rewards));
    expect(storedPlayer?.rewards_json).toBe(JSON.stringify(EVENT.result.rewards["player-one"]));
  });

  it("persists a return outcome with its partial reward", async () => {
    const event: MatchFinishedEvent = {
      ...EVENT,
      eventId: "match-return:finished",
      matchId: "match-return",
      result: {
        outcome: "return",
        durationMs: 120_000,
        completedAtTick: 1_200,
        rewards: { "player-one": { currency: 60, experience: 30 } },
      },
    };

    await expect(persistMatchResult(env.DB, event)).resolves.toBe("stored");
    const stored = await env.DB.prepare("SELECT outcome FROM match_results WHERE match_id = ?1")
      .bind(event.matchId)
      .first<{ outcome: string }>();
    expect(stored?.outcome).toBe("return");
  });
});

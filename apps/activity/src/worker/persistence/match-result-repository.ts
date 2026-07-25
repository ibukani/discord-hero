import { CURRENT_CONTENT } from "@discord-hero/content";
import type { MatchFinishedEvent } from "@discord-hero/protocol";

export async function persistMatchResult(
  db: D1Database,
  event: MatchFinishedEvent,
): Promise<"stored" | "duplicate"> {
  const existing = await db
    .prepare("SELECT event_id FROM processed_events WHERE event_id = ?1")
    .bind(event.eventId)
    .first<{ event_id: string }>();
  if (existing !== null) {
    return "duplicate";
  }

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO match_results (
          match_id, ruleset_version, content_version, seed, outcome,
          started_at, ended_at, duration_ms, rewards_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        event.matchId,
        event.rulesetVersion,
        event.contentVersion,
        event.seed,
        event.result.outcome,
        event.startedAt,
        event.endedAt,
        event.result.durationMs,
        JSON.stringify(event.result.rewards),
      ),
  ];

  for (const player of event.players) {
    statements.push(
      db
        .prepare(
          `INSERT INTO players (id, discord_user_id, display_name, created_at, last_seen_at)
           VALUES (?1, NULL, ?2, ?3, ?3)
           ON CONFLICT(id) DO UPDATE SET
             display_name = excluded.display_name,
             last_seen_at = excluded.last_seen_at`,
        )
        .bind(player.playerId, player.displayName, event.endedAt),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO player_progress (player_id, updated_at)
           VALUES (?1, ?2)
           ON CONFLICT(player_id) DO NOTHING`,
        )
        .bind(player.playerId, event.endedAt),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO match_players (
            match_id, player_id, class_id, score, stats_json, rewards_json
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(
          event.matchId,
          player.playerId,
          player.classId,
          player.score,
          JSON.stringify(player.stats),
          JSON.stringify(event.result.rewards[player.playerId] ?? { currency: 0, experience: 0 }),
        ),
    );
    const reward = event.result.rewards[player.playerId] ?? { currency: 0, experience: 0 };
    statements.push(
      db
        .prepare(
          `UPDATE player_progress
           SET account_level = MAX(account_level, CAST((experience + ?1) / 100 AS INTEGER) + 1),
               experience = experience + ?1,
               game_currency = game_currency + ?2,
               version = version + 1,
               updated_at = ?3
           WHERE player_id = ?4`,
        )
        .bind(reward.experience, reward.currency, event.endedAt, player.playerId),
    );

    for (const unlockId of event.result.unlocks[player.playerId] ?? []) {
      const unlock = CURRENT_CONTENT.unlocks[unlockId];
      if (unlock === undefined) {
        continue;
      }
      if (
        unlock.condition.type !== "match_outcome" ||
        unlock.condition.outcome !== event.result.outcome
      ) {
        continue;
      }
      statements.push(
        db
          .prepare(
            `INSERT INTO unlocks (player_id, unlock_type, content_id, unlocked_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(player_id, unlock_type, content_id) DO NOTHING`,
          )
          .bind(player.playerId, unlock.unlockType, unlock.contentId, event.endedAt),
      );
    }

    for (const unlock of Object.values(CURRENT_CONTENT.unlocks)) {
      if (unlock.condition.type !== "account_level") {
        continue;
      }
      statements.push(
        db
          .prepare(
            `INSERT INTO unlocks (player_id, unlock_type, content_id, unlocked_at)
             SELECT ?1, ?2, ?3, ?4
             WHERE EXISTS (
               SELECT 1 FROM player_progress
               WHERE player_id = ?1 AND account_level >= ?5
             )
             ON CONFLICT(player_id, unlock_type, content_id) DO NOTHING`,
          )
          .bind(
            player.playerId,
            unlock.unlockType,
            unlock.contentId,
            event.endedAt,
            unlock.condition.minimum,
          ),
      );
    }
  }

  statements.push(
    db
      .prepare("INSERT INTO processed_events (event_id, processed_at) VALUES (?1, ?2)")
      .bind(event.eventId, event.endedAt),
  );

  try {
    await db.batch(statements);
    return "stored";
  } catch (error: unknown) {
    const duplicateAfterRace = await db
      .prepare("SELECT event_id FROM processed_events WHERE event_id = ?1")
      .bind(event.eventId)
      .first<{ event_id: string }>();
    if (duplicateAfterRace !== null) {
      return "duplicate";
    }
    throw error;
  }
}

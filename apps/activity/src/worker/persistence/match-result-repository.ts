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
          started_at, ended_at, duration_ms
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
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
            match_id, player_id, class_id, score, stats_json
          ) VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
        .bind(
          event.matchId,
          player.playerId,
          player.classId,
          player.score,
          JSON.stringify(player.stats),
        ),
    );
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

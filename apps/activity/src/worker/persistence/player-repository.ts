export interface PlayerRecordInput {
  readonly id: string;
  readonly discordUserId: string | null;
  readonly displayName: string;
  readonly now: string;
}

export async function upsertPlayer(db: D1Database, input: PlayerRecordInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO players (id, discord_user_id, display_name, created_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(input.id, input.discordUserId, input.displayName, input.now)
    .run();

  await db
    .prepare(
      `INSERT INTO player_progress (player_id, updated_at)
       VALUES (?1, ?2)
       ON CONFLICT(player_id) DO NOTHING`,
    )
    .bind(input.id, input.now)
    .run();
}

import {
  AutomationPolicySchema,
  HeroClassIdSchema,
  LoadoutSchema,
  type AutomationPolicyDto,
  type HeroClassIdDto,
  type LoadoutDto,
} from "@discord-hero/protocol";
import { z } from "zod";

export interface PlayerRecordInput {
  readonly id: string;
  readonly discordUserId: string | null;
  readonly displayName: string;
  readonly initialClassId: HeroClassIdDto;
  readonly now: string;
}

export interface PlayerPreferences {
  readonly classId: HeroClassIdDto;
  readonly loadout: LoadoutDto | null;
  readonly automation: AutomationPolicyDto | null;
}

const PlayerPreferenceRowSchema = z.object({
  class_id: HeroClassIdSchema,
  loadout_json: z.string().nullable(),
  automation_json: z.string().nullable(),
});

export async function upsertPlayer(db: D1Database, input: PlayerRecordInput): Promise<void> {
  const playerStatement = db
    .prepare(
      `INSERT INTO players (id, discord_user_id, display_name, created_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(input.id, input.discordUserId, input.displayName, input.now);

  const progressStatement = db
    .prepare(
      `INSERT INTO player_progress (player_id, updated_at)
       VALUES (?1, ?2)
       ON CONFLICT(player_id) DO NOTHING`,
    )
    .bind(input.id, input.now);

  const preferenceStatement = db
    .prepare(
      `INSERT INTO player_preferences (
         player_id, class_id, loadout_json, automation_json, updated_at
       ) VALUES (?1, ?2, NULL, NULL, ?3)
       ON CONFLICT(player_id) DO NOTHING`,
    )
    .bind(input.id, input.initialClassId, input.now);

  await db.batch([playerStatement, progressStatement, preferenceStatement]);
}

export async function loadPlayerPreferences(
  db: D1Database,
  playerId: string,
): Promise<PlayerPreferences | null> {
  const raw = await db
    .prepare(
      `SELECT class_id, loadout_json, automation_json
       FROM player_preferences
       WHERE player_id = ?1`,
    )
    .bind(playerId)
    .first<unknown>();
  if (raw === null) {
    const player = await db
      .prepare("SELECT id FROM players WHERE id = ?1")
      .bind(playerId)
      .first<unknown>();
    return player === null ? null : { classId: "guardian", loadout: null, automation: null };
  }
  const row = PlayerPreferenceRowSchema.safeParse(raw);
  if (!row.success) {
    return { classId: "guardian", loadout: null, automation: null };
  }

  const loadout = parseJsonField(row.data.loadout_json, LoadoutSchema);
  const automation = parseJsonField(row.data.automation_json, AutomationPolicySchema);
  return {
    classId: row.data.class_id,
    loadout,
    automation,
  };
}

export async function savePlayerPreferences(
  db: D1Database,
  playerId: string,
  preferences: PlayerPreferences,
  now: string,
): Promise<void> {
  const player = await db
    .prepare("SELECT id FROM players WHERE id = ?1")
    .bind(playerId)
    .first<unknown>();
  if (player === null) {
    return;
  }

  await db
    .prepare(
      `INSERT INTO player_preferences (
         player_id, class_id, loadout_json, automation_json, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(player_id) DO UPDATE SET
         class_id = excluded.class_id,
         loadout_json = excluded.loadout_json,
         automation_json = excluded.automation_json,
         updated_at = excluded.updated_at`,
    )
    .bind(
      playerId,
      preferences.classId,
      JSON.stringify(preferences.loadout),
      JSON.stringify(preferences.automation),
      now,
    )
    .run();
}

function parseJsonField<T>(value: string | null, schema: z.ZodType<T>): T | null {
  if (value === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value) as unknown;
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

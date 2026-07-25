import {
  AccountProgressSchema,
  AutomationPolicySchema,
  DEFAULT_ACCOUNT_PROGRESS,
  HeroClassIdSchema,
  LoadoutSchema,
  SafeIdSchema,
  type AccountProgress,
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
  readonly accountProgress: AccountProgress;
  readonly unlockedContentIds: readonly string[];
}

export type PlayerPreferenceInput = Omit<PlayerPreferences, "accountProgress">;

const PlayerPreferenceRowSchema = z.object({
  class_id: HeroClassIdSchema,
  loadout_json: z.string().nullable(),
  automation_json: z.string().nullable(),
});
const JoinedPlayerRowSchema = z.object({
  player_id: SafeIdSchema,
  class_id: z.unknown(),
  loadout_json: z.unknown(),
  automation_json: z.unknown(),
  account_level: z.unknown(),
  experience: z.unknown(),
  game_currency: z.unknown(),
});
const NullableStringSchema = z.string().nullable();
const PlayerProgressRowSchema = z.object({
  account_level: z.number().int().positive(),
  experience: z.number().int().nonnegative(),
  game_currency: z.number().int().nonnegative(),
});
const UnlockRowSchema = z.object({ content_id: SafeIdSchema });

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
  const [raw, unlockRows] = await Promise.all([
    db
      .prepare(
        `SELECT
           players.id AS player_id,
           player_preferences.class_id,
           player_preferences.loadout_json,
           player_preferences.automation_json,
           player_progress.account_level,
           player_progress.experience,
           player_progress.game_currency
         FROM players
         LEFT JOIN player_preferences ON player_preferences.player_id = players.id
         LEFT JOIN player_progress ON player_progress.player_id = players.id
         WHERE players.id = ?1`,
      )
      .bind(playerId)
      .first<unknown>(),
    db
      .prepare(
        `SELECT content_id
         FROM unlocks
         WHERE player_id = ?1`,
      )
      .bind(playerId)
      .all<unknown>(),
  ]);
  const joinedRow = JoinedPlayerRowSchema.safeParse(raw);
  if (!joinedRow.success) {
    return null;
  }

  const preferenceRow = PlayerPreferenceRowSchema.safeParse({
    class_id: joinedRow.data.class_id,
    loadout_json: joinedRow.data.loadout_json,
    automation_json: joinedRow.data.automation_json,
  });
  const loadoutJson = NullableStringSchema.safeParse(joinedRow.data.loadout_json);
  const automationJson = NullableStringSchema.safeParse(joinedRow.data.automation_json);
  const loadout = loadoutJson.success ? parseJsonField(loadoutJson.data, LoadoutSchema) : null;
  const automation = automationJson.success
    ? parseJsonField(automationJson.data, AutomationPolicySchema)
    : null;
  const accountProgress = loadAccountProgressFromRow(joinedRow.data);
  const unlockedContentIds = unlockRows.results.flatMap((value: unknown) => {
    const parsed = UnlockRowSchema.safeParse(value);
    return parsed.success ? [parsed.data.content_id] : [];
  });
  const accountProgressWithUnlocks: AccountProgress = {
    ...accountProgress,
    unlockedContentIds: [...new Set(unlockedContentIds)],
  };
  return {
    classId: preferenceRow.success ? preferenceRow.data.class_id : "guardian",
    loadout,
    automation,
    accountProgress: accountProgressWithUnlocks,
    unlockedContentIds: accountProgressWithUnlocks.unlockedContentIds,
  };
}

export async function savePlayerPreferences(
  db: D1Database,
  playerId: string,
  preferences: PlayerPreferenceInput,
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

function loadAccountProgressFromRow(row: z.infer<typeof JoinedPlayerRowSchema>): AccountProgress {
  const parsed = PlayerProgressRowSchema.safeParse({
    account_level: row.account_level,
    experience: row.experience,
    game_currency: row.game_currency,
  });
  if (!parsed.success) {
    return {
      ...DEFAULT_ACCOUNT_PROGRESS,
      unlockedContentIds: [],
    };
  }
  return AccountProgressSchema.parse({
    accountLevel: parsed.data.account_level,
    experience: parsed.data.experience,
    nextLevelExperience: parsed.data.account_level * 100,
    gameCurrency: parsed.data.game_currency,
    unlockedContentIds: [],
  });
}

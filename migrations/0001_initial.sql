PRAGMA foreign_keys = ON;

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  discord_user_id TEXT UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE player_progress (
  player_id TEXT PRIMARY KEY,
  account_level INTEGER NOT NULL DEFAULT 1 CHECK (account_level >= 1),
  experience INTEGER NOT NULL DEFAULT 0 CHECK (experience >= 0),
  game_currency INTEGER NOT NULL DEFAULT 0 CHECK (game_currency >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE unlocks (
  player_id TEXT NOT NULL,
  unlock_type TEXT NOT NULL,
  content_id TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY (player_id, unlock_type, content_id),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE match_results (
  match_id TEXT PRIMARY KEY,
  ruleset_version TEXT NOT NULL,
  content_version TEXT NOT NULL,
  seed TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('victory', 'defeat', 'abandoned')),
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0)
);

CREATE TABLE match_players (
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0),
  stats_json TEXT NOT NULL,
  PRIMARY KEY (match_id, player_id),
  FOREIGN KEY (match_id) REFERENCES match_results(match_id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
);

CREATE TABLE processed_events (
  event_id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);

CREATE INDEX idx_players_last_seen_at ON players(last_seen_at);
CREATE INDEX idx_match_results_ended_at ON match_results(ended_at);
CREATE INDEX idx_match_players_player_id ON match_players(player_id);

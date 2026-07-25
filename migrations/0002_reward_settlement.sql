PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_match_players_player_id;
DROP INDEX IF EXISTS idx_match_results_ended_at;

ALTER TABLE match_players RENAME TO match_players_legacy;
ALTER TABLE match_results RENAME TO match_results_legacy;

CREATE TABLE match_results (
  match_id TEXT PRIMARY KEY,
  ruleset_version TEXT NOT NULL,
  content_version TEXT NOT NULL,
  seed TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('victory', 'defeat', 'return')),
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  rewards_json TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO match_results (
  match_id,
  ruleset_version,
  content_version,
  seed,
  outcome,
  started_at,
  ended_at,
  duration_ms,
  rewards_json
)
SELECT
  match_id,
  ruleset_version,
  content_version,
  seed,
  CASE outcome WHEN 'abandoned' THEN 'return' ELSE outcome END,
  started_at,
  ended_at,
  duration_ms,
  '{}'
FROM match_results_legacy;

CREATE TABLE match_players (
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0),
  stats_json TEXT NOT NULL,
  rewards_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (match_id, player_id),
  FOREIGN KEY (match_id) REFERENCES match_results(match_id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
);

INSERT INTO match_players (match_id, player_id, class_id, score, stats_json, rewards_json)
SELECT match_id, player_id, class_id, score, stats_json, '{}'
FROM match_players_legacy;

DROP TABLE match_players_legacy;
DROP TABLE match_results_legacy;

CREATE INDEX idx_match_results_ended_at ON match_results(ended_at);
CREATE INDEX idx_match_players_player_id ON match_players(player_id);

PRAGMA foreign_keys = ON;

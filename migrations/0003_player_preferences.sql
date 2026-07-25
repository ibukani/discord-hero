CREATE TABLE player_preferences (
  player_id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  loadout_json TEXT,
  automation_json TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX idx_player_preferences_updated_at ON player_preferences(updated_at);

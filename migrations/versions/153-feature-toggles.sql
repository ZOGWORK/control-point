-- 153-feature-toggles.sql — owner feature toggles (Owner console → Features).
--   feature_flags: the global switch per feature key (server/features.ts
--     FEATURES is the registry; an unregistered key is never gated).
--   team_feature_overrides: one team's override; a row wins over the global
--     switch, no row means the team inherits it.
--   feature_flag_audit: every flip. scope is 'global', 'team' or 'inherit'
--     (an override removed); enabled is the value the scope has afterwards.
-- New tables only: nothing else references them, and turning a feature off
-- never touches its data. Seeds the global rows for the gated features
-- (messaging, whats_new) as on, so behavior is unchanged until the owner acts.
BEGIN;

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS team_feature_overrides (
  team_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  updated_by INTEGER,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (team_id, key),
  FOREIGN KEY (team_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS feature_flag_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  scope TEXT NOT NULL,
  team_id INTEGER,
  enabled INTEGER NOT NULL,
  changed_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id)
);

INSERT OR IGNORE INTO feature_flags (key, enabled) VALUES ('messaging', 1);
INSERT OR IGNORE INTO feature_flags (key, enabled) VALUES ('whats_new', 1);

COMMIT;

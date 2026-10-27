-- 151-cad-robots-seasons.sql — CAD organised by FTC season and robot, and
-- part choices made in Control Point that Control Kit picks up.
-- Contract: control-kit docs/control-point-link.md (v1.1, §2 "Where an import
-- lands" and §5).
--   cad_robots: a team's robots. season is the FTC season's starting year
--     (2025 = 2025–26 DECODE); a season may hold several robots, one of them
--     is_main. document_id/element_id link the robot's Onshape assembly, so a
--     Control Kit send of that assembly lands on it (unique per team).
--   robot_id on cad_parts, cad_docs, cad_reviews, cad_snapshots, cad_imports:
--     the robot a row belongs to. Every new row gets one; a row left NULL (an
--     older client) is shown on the team's default robot (latest season's main).
--   cad_parts.choice_*: what a person chose in Control Point for an imported
--     part. choice_type_set = 1 means a type choice exists (choice_type NULL
--     is "let Control Kit decide"); choice_product is "vendor:normalizedSku".
--     Imports never touch these columns, so a re-send keeps them.
--   cad_part_choices: every choice ever made, never updated.
--   manage_cad: the role permission for making those choices and managing
--     robots. The default Member and Verified Member roles get it (admins have
--     "*"), as 111 did for the notebook.
-- Existing CAD rows move to one "Competition robot" in 2025–26 per team that
-- has any; nothing is deleted. That robot takes the assembly of the team's
-- latest Control Kit import, if there is one.

BEGIN;

CREATE TABLE IF NOT EXISTS cad_robots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  name TEXT NOT NULL,
  is_main INTEGER NOT NULL DEFAULT 0,
  document_id TEXT,
  element_id TEXT,
  assembly_url TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_cad_robots_team ON cad_robots(team_id, season);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cad_robots_assembly
  ON cad_robots(team_id, document_id, element_id) WHERE document_id IS NOT NULL;
-- At most one main robot per team and season, whatever sends race.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cad_robots_main
  ON cad_robots(team_id, season) WHERE is_main = 1;

ALTER TABLE cad_parts ADD COLUMN robot_id INTEGER;
ALTER TABLE cad_docs ADD COLUMN robot_id INTEGER;
ALTER TABLE cad_reviews ADD COLUMN robot_id INTEGER;
ALTER TABLE cad_snapshots ADD COLUMN robot_id INTEGER;
ALTER TABLE cad_imports ADD COLUMN robot_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_cad_parts_robot ON cad_parts(team_id, robot_id);

ALTER TABLE cad_parts ADD COLUMN choice_type TEXT;
ALTER TABLE cad_parts ADD COLUMN choice_type_set INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cad_parts ADD COLUMN choice_type_by TEXT;
ALTER TABLE cad_parts ADD COLUMN choice_type_by_id INTEGER;
ALTER TABLE cad_parts ADD COLUMN choice_type_at TEXT;
ALTER TABLE cad_parts ADD COLUMN choice_product TEXT;
ALTER TABLE cad_parts ADD COLUMN choice_product_by TEXT;
ALTER TABLE cad_parts ADD COLUMN choice_product_by_id INTEGER;
ALTER TABLE cad_parts ADD COLUMN choice_product_at TEXT;
CREATE INDEX IF NOT EXISTS idx_cad_parts_ck_document ON cad_parts(team_id, ck_document_id) WHERE ck_part_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS cad_part_choices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  part_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  value TEXT,
  by_member_id INTEGER,
  by_name TEXT,
  at TEXT NOT NULL,
  FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY(part_id) REFERENCES cad_parts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cad_part_choices_part ON cad_part_choices(part_id, id);

-- One 2025–26 robot for every team with CAD rows.
INSERT INTO cad_robots (team_id, season, name, is_main, created_at, updated_at)
SELECT t.team_id, 2025, 'Competition robot', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM (SELECT team_id FROM cad_parts UNION SELECT team_id FROM cad_docs UNION SELECT team_id FROM cad_reviews
        UNION SELECT team_id FROM cad_snapshots UNION SELECT team_id FROM cad_imports) t
 WHERE t.team_id IN (SELECT id FROM teams)
   AND NOT EXISTS (SELECT 1 FROM cad_robots r WHERE r.team_id = t.team_id);

-- It takes the assembly of the team's latest import, so the next send of that assembly lands on it.
UPDATE cad_robots SET
  document_id = (SELECT i.document_id FROM cad_imports i WHERE i.team_id = cad_robots.team_id ORDER BY i.id DESC LIMIT 1),
  element_id = (SELECT i.element_id FROM cad_imports i WHERE i.team_id = cad_robots.team_id ORDER BY i.id DESC LIMIT 1),
  assembly_url = (SELECT i.assembly_url FROM cad_imports i WHERE i.team_id = cad_robots.team_id ORDER BY i.id DESC LIMIT 1)
 WHERE document_id IS NULL AND season = 2025 AND is_main = 1
   AND EXISTS (SELECT 1 FROM cad_imports i WHERE i.team_id = cad_robots.team_id);

UPDATE cad_parts SET robot_id = (SELECT r.id FROM cad_robots r WHERE r.team_id = cad_parts.team_id AND r.season = 2025 AND r.is_main = 1 ORDER BY r.id LIMIT 1) WHERE robot_id IS NULL;
UPDATE cad_docs SET robot_id = (SELECT r.id FROM cad_robots r WHERE r.team_id = cad_docs.team_id AND r.season = 2025 AND r.is_main = 1 ORDER BY r.id LIMIT 1) WHERE robot_id IS NULL;
UPDATE cad_reviews SET robot_id = (SELECT r.id FROM cad_robots r WHERE r.team_id = cad_reviews.team_id AND r.season = 2025 AND r.is_main = 1 ORDER BY r.id LIMIT 1) WHERE robot_id IS NULL;
UPDATE cad_snapshots SET robot_id = (SELECT r.id FROM cad_robots r WHERE r.team_id = cad_snapshots.team_id AND r.season = 2025 AND r.is_main = 1 ORDER BY r.id LIMIT 1) WHERE robot_id IS NULL;
UPDATE cad_imports SET robot_id = (SELECT r.id FROM cad_robots r WHERE r.team_id = cad_imports.team_id AND r.season = 2025 AND r.is_main = 1 ORDER BY r.id LIMIT 1) WHERE robot_id IS NULL;

UPDATE roles SET permissions = json_insert(permissions, '$[#]', 'manage_cad')
WHERE is_system = 1 AND name IN ('Member', 'Verified Member') AND json_valid(permissions)
  AND NOT EXISTS (SELECT 1 FROM json_each(permissions) WHERE value = 'manage_cad');

COMMIT;

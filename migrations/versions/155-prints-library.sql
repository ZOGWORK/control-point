-- 155-prints-library.sql — the Prints library (server/prints.ts,
-- src/types/prints.ts): a team's 3D print files, organised two ways at once.
--   print_folders: where a file lives. parent_id NULL is the library root.
--     Names are unique per parent, ignoring case.
--   print_files: one row per file; the bytes live on the VM's disk under
--     PRINTS_DIR at storage_key (never derived from a user-typed name), with
--     an optional PNG thumbnail at thumb_key (thumb_size counts toward the
--     workspace quota with size). Smart groups are computed from
--     these details: robot_id (its season comes from the robot) or season,
--     cad_part_id (its assembly section is the subsystem and its quantity the
--     copies needed unless set here), material, status. source is 'upload'
--     or 'control-kit'; ck_part_key is the Control Kit identity it prints.
--   print_collections / print_collection_files: groups a team makes itself
--     ("Comp spares", "Worlds kit"). A file belongs to any number of them
--     without being copied.
--   print_activity: every change, never updated.
--   manage_prints: the role permission for uploading, moving, renaming,
--     deleting and editing details. Every role that can manage CAD gets
--     it (admins have "*"); members without it view and download.
-- New tables only; nothing existing changes.
BEGIN;

CREATE TABLE IF NOT EXISTS print_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  parent_id INTEGER,
  name TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_print_folders_name ON print_folders (team_id, COALESCE(parent_id, 0), name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS print_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  folder_id INTEGER,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  thumb_key TEXT,
  thumb_size INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  robot_id INTEGER,
  season INTEGER,
  cad_part_id INTEGER,
  subsystem TEXT,
  material TEXT,
  status TEXT NOT NULL DEFAULT 'to_print',
  copies_needed INTEGER,
  copies_printed INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'upload',
  ck_part_key TEXT,
  uploaded_by INTEGER,
  uploaded_by_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_print_files_name ON print_files (team_id, COALESCE(folder_id, 0), name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_print_files_team ON print_files (team_id, folder_id);

CREATE TABLE IF NOT EXISTS print_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_print_collections_name ON print_collections (team_id, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS print_collection_files (
  collection_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, file_id)
);
CREATE INDEX IF NOT EXISTS idx_print_collection_files_file ON print_collection_files (file_id);

CREATE TABLE IF NOT EXISTS print_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  file_id INTEGER,
  folder_id INTEGER,
  member_id INTEGER,
  member_name TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_print_activity_team ON print_activity (team_id, id);
CREATE INDEX IF NOT EXISTS idx_print_activity_file ON print_activity (file_id);

UPDATE roles SET permissions = json_insert(permissions, '$[#]', 'manage_prints')
WHERE json_valid(permissions)
  AND EXISTS (SELECT 1 FROM json_each(permissions) WHERE value = 'manage_cad')
  AND NOT EXISTS (SELECT 1 FROM json_each(permissions) WHERE value = 'manage_prints');

COMMIT;

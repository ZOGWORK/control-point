-- 150-control-kit-link.sql — linking Control Kit (the Onshape BOM app) to a
-- Control Point account, and the BOMs it sends into a workspace's parts list.
-- Contract: control-kit docs/control-point-link.md (v1).
--   cad_parts.ck_*: where an imported row came from. ck_document_id and
--     ck_element_id are the Onshape assembly; ck_part_key is Control Kit's
--     stable part identity (document:element:part:configuration). A row is
--     matched on (team_id, ck_document_id, ck_element_id, ck_part_key), so a
--     new scan updates it in place. ck_removed_at: the latest scan of that
--     assembly no longer has it ("Not in latest scan"); it is never deleted.
--     Hand-made parts leave every ck_* column NULL.
--   cad_docs.ck_import_id: a file Control Kit sent with that import.
--   cad_imports: one row per BOM sent, unique per (team, idempotency key), so
--     the same scan sent twice to a workspace is one import. finished_at is
--     set once its files are stored; until then claimed_at says who is
--     storing them, so a retry waits for that or finishes a stalled one.
--   control_kit_codes: one-use authorization codes (SHA-256 only), 5 minutes,
--     bound to the account email and the redirect URI.
--   control_kit_tokens: bearer tokens (SHA-256 only) for one account email;
--     no expiry, revocable.

BEGIN;

ALTER TABLE cad_parts ADD COLUMN ck_document_id TEXT;
ALTER TABLE cad_parts ADD COLUMN ck_element_id TEXT;
ALTER TABLE cad_parts ADD COLUMN ck_part_key TEXT;
ALTER TABLE cad_parts ADD COLUMN ck_import_id INTEGER;
ALTER TABLE cad_parts ADD COLUMN ck_extra TEXT;
ALTER TABLE cad_parts ADD COLUMN ck_removed_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cad_parts_ck_key
  ON cad_parts(team_id, ck_document_id, ck_element_id, ck_part_key) WHERE ck_part_key IS NOT NULL;

ALTER TABLE cad_docs ADD COLUMN ck_import_id INTEGER;

CREATE TABLE IF NOT EXISTS cad_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  document_id TEXT NOT NULL,
  element_id TEXT NOT NULL,
  assembly_name TEXT,
  assembly_url TEXT,
  revision TEXT,
  part_count INTEGER NOT NULL DEFAULT 0,
  sent_by TEXT,
  sent_by_member_id INTEGER,
  created_at TEXT NOT NULL,
  files TEXT,
  result TEXT,
  claimed_at TEXT,
  finished_at TEXT,
  UNIQUE(team_id, idempotency_key),
  FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cad_imports_assembly ON cad_imports(team_id, document_id, element_id, id);

CREATE TABLE IF NOT EXISTS control_kit_codes (
  code_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS control_kit_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_control_kit_tokens_email ON control_kit_tokens(email);

COMMIT;

-- 154-cad-part-pictures.sql — each Control Kit part's Onshape picture
-- (contract: control-kit docs/control-point-link.md v1.2 §6).
--   cad_parts.ck_picture_url: the stored PNG (/api/files/:id, kind 'cad').
--   cad_parts.ck_picture_key: Control Kit's name for the revision it drew, so a
--     later send skips pictures Control Point already holds.
--   cad_parts.ck_picture_at: when it was stored here.
-- Imports never touch these columns; only the pictures route writes them.
BEGIN;

ALTER TABLE cad_parts ADD COLUMN ck_picture_url TEXT;
ALTER TABLE cad_parts ADD COLUMN ck_picture_key TEXT;
ALTER TABLE cad_parts ADD COLUMN ck_picture_at TEXT;

COMMIT;

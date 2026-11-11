-- 157-scout-signin-codes.sql — "Continue with Control Scout" on Control Point.
--
-- The reverse of scout_handoff_codes (migration 129): Control Scout vouches
-- for its signed-in user by asking for a code server to server
-- (POST /internal/signin/codes, X-Internal-Key), then sends the browser back
-- to /api/auth/control-scout/callback with it. Single use, sha256-hashed,
-- 2-minute TTL, bound to the state Control Point started the sign-in with.
-- Nothing here touches members, verified_emails or proven_passwords.

CREATE TABLE IF NOT EXISTS scout_signin_codes (
  code_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,                -- lower-cased, trimmed (the shared account's email)
  display_name TEXT,                  -- Scout's display name, if any
  my_team INTEGER,                    -- the FTC team the person follows in Scout, if any
  state TEXT NOT NULL,
  expires_at TEXT NOT NULL,           -- ISO
  used_at TEXT
);

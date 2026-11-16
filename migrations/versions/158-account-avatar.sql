-- 158-account-avatar.sql — one profile picture per shared account.
--
-- The picture Control Scout and Control Point both show for an account
-- (server/sharedAccounts.ts: setAccountAvatar, GET/PUT/DELETE
-- /internal/accounts/:id/avatar). Same value shape as members.avatar_url:
-- a local /api/files/N (stored_files kind avatar), a legacy https URL, or
-- NULL. Account-wide picture changes also write every active members row
-- with the email, so NULL here falls back to those rows.

ALTER TABLE accounts ADD COLUMN avatar_url TEXT;

-- 152-age-confirmations.sql: members who said they are 18 or older (an
-- honesty system: nothing is verified). One row per account email, so every
-- workspace of a multi-team account agrees. No row means not confirmed:
-- swear words in member text stay hidden for that account.

CREATE TABLE IF NOT EXISTS age_confirmations (
  email TEXT PRIMARY KEY,
  confirmed_at TEXT NOT NULL
);

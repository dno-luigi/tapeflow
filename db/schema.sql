-- TapeFlow D1 schema. Safe to run more than once.
--
-- Apply locally:  npx wrangler d1 execute tapeflow --local  --file=db/schema.sql
-- Apply remotely: npx wrangler d1 execute tapeflow --remote --file=db/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE, -- stored lowercased
  name          TEXT,
  password_hash TEXT NOT NULL,        -- pbkdf2$iterations$salt$hash
  created_at    TEXT NOT NULL
);

-- One row per signed-in device. Only the SHA-256 of the token is stored, so a
-- dump of this table cannot be replayed against the API.
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_sessions_by_user ON auth_sessions (user_id);

-- The app's own data (one table, `sessions`: see ALLOWED_TABLES in
-- worker/index.js). Values are JSON so a session's tracks and cues travel with
-- the row; ownership is the user_id column and never comes from the request body.
CREATE TABLE IF NOT EXISTS records (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  tbl        TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS records_by_owner ON records (user_id, tbl, created_at);

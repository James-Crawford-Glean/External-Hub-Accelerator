-- 001_app_users.sql — the user registry.
--
-- Every "who" reference in the portal resolves to our own usr_* id, keyed by
-- email. Upstream systems' user ids never become keys; add a nullable
-- satellite column (and an index) when you connect one.
--
-- Every migration in this directory is written IF NOT EXISTS / ON CONFLICT and
-- re-runs on every apply, so there is no applied-migrations ledger.
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.users (
  id          text PRIMARY KEY,               -- usr_<base62>
  email       text NOT NULL,                  -- stored lowercased
  name        text,
  title       text,
  is_active   boolean NOT NULL DEFAULT true,
  source      text,                           -- app_login / manual / <your sync>
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx ON app.users (lower(email));

-- Per-user default view per screen (surface).
CREATE TABLE IF NOT EXISTS app.user_view_prefs (
  owner_user_id   text NOT NULL,
  surface         text NOT NULL,
  default_view_id text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, surface)
);

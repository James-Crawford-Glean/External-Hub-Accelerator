-- 002_access.sql — who may use the portal, and with what role.
--
-- app.access_roster is the authz source of truth (see libs/roster). Admin is
-- orthogonal to the role. The table ships empty; seed the first administrator
-- before the first sign-in:
--   INSERT INTO app.access_roster (email, role, is_admin)
--   VALUES ('you@example.com', 'ADMINISTRATOR', true);
--
-- app.access_requests records authenticated callers who are not on the roster,
-- so an administrator can grant access from the admin screen.
CREATE TABLE IF NOT EXISTS app.access_roster (
  email      text PRIMARY KEY,                  -- lowercased
  role       text NOT NULL,                     -- ADMINISTRATOR / EDITOR / VIEWER
  is_admin   boolean NOT NULL DEFAULT false,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.access_requests (
  email      text PRIMARY KEY,
  name       text,
  sub        text,                              -- Cognito sub, for support
  attempts   integer     NOT NULL DEFAULT 1,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.login_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text        NOT NULL,
  sub        text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_events_email_time ON app.login_events (email, created_at DESC);

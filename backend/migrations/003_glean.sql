-- 003_glean.sql — per-user Glean OAuth.
--
-- The portal registers itself with the Glean tenant's authorization server
-- through Dynamic Client Registration once per base URL (glean_oauth_client),
-- walks each user through Authorization Code + PKCE (glean_oauth_state), and
-- keeps that user's tokens (glean_tokens) keyed by the registry id. The admin
-- may override the tenant base URL at runtime (glean_config).
CREATE TABLE IF NOT EXISTS app.glean_oauth_client (
  glean_base_url text PRIMARY KEY,
  client_id      text NOT NULL,
  scope          text,
  registered_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.glean_oauth_state (
  state          text PRIMARY KEY,
  owner_user_id  text NOT NULL,
  code_verifier  text NOT NULL,
  redirect_uri   text NOT NULL,
  glean_base_url text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.glean_tokens (
  owner_user_id  text PRIMARY KEY,
  glean_base_url text NOT NULL,
  access_token   text NOT NULL,
  refresh_token  text,
  scope          text,
  expires_at     timestamptz,
  email          text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.glean_config (
  id         boolean PRIMARY KEY DEFAULT true,
  base_url   text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT glean_config_singleton CHECK (id)
);

-- Glean-sourced profile photos, re-hosted under the SPA bucket's avatars/ prefix.
CREATE TABLE IF NOT EXISTS app.user_avatars (
  email           text PRIMARY KEY,
  avatar_url      text,
  glean_person_id text,
  synced_at       timestamptz NOT NULL DEFAULT now()
);

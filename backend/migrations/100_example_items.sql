-- 100_example_items.sql — the example domain.
--
-- One entity, `items`, exercising every platform path: a list and detail view
-- in the SPA, GraphQL reads and write-gated mutations, a scheduled sync from
-- an upstream system (keyed by external_id, never by the upstream's id as PK),
-- row-level visibility, MCP read and write tools, and a push to the Glean
-- Indexing API. Replace this schema with your domain; keep the shape.
CREATE SCHEMA IF NOT EXISTS example;

CREATE TABLE IF NOT EXISTS example.items (
  id              text PRIMARY KEY,                 -- itm_<base62>
  external_id     text,                             -- upstream system's id (satellite)
  name            text NOT NULL,
  category        text,
  -- ACTIVE / ARCHIVED are live states. DRAFT is where an assistant-initiated
  -- create lands (the MCP createItem tool); it is hidden from default reads
  -- until a writer approves it (-> ACTIVE) or rejects it (-> REJECTED, kept
  -- for audit, hidden). SPA and GraphQL creates write ACTIVE directly.
  status          text NOT NULL DEFAULT 'ACTIVE',
  description     text,
  website         text,                             -- domain; drives the logo cache
  owner_user_id   text,                             -- usr_* (app.users)
  visibility_role text,                             -- NULL = everyone; else a roster role
  source          text,                             -- sync / app / mcp
  synced_at       timestamptz,
  indexed_at      timestamptz,                      -- last successful Glean Indexing API push
  reviewed_at     timestamptz,                      -- review audit: who approved or rejected a DRAFT, and when
  reviewed_by_id  text,
  reviewed_by_email text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS items_external_id_uidx ON example.items (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS items_name_idx ON example.items (lower(name));
CREATE INDEX IF NOT EXISTS items_updated_idx ON example.items (updated_at DESC);
-- One pending draft per owner and name: the idempotency key for assistant-initiated
-- creates, enforced here so two concurrent retries cannot both insert.
CREATE UNIQUE INDEX IF NOT EXISTS items_pending_draft_uidx ON example.items (owner_user_id, lower(name)) WHERE status = 'DRAFT';

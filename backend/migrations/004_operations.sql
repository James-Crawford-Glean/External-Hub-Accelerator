-- 004_operations.sql — operational tables the platform Lambdas read and write.
CREATE TABLE IF NOT EXISTS app.warmer_config (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled     boolean NOT NULL DEFAULT true,
  concurrency integer NOT NULL DEFAULT 2 CHECK (concurrency BETWEEN 0 AND 20),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);
INSERT INTO app.warmer_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- One row per scheduled-job execution.
CREATE TABLE IF NOT EXISTS app.sync_runs (
  id                text PRIMARY KEY,            -- run_*
  entity            text NOT NULL,               -- what was synced
  type              text NOT NULL,               -- full / incremental / enrich
  status            text NOT NULL,               -- running / success / partial / failed
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  records_processed integer,
  records_created   integer,
  records_updated   integer,
  records_deleted   integer,
  records_remaining integer,
  error_count       integer NOT NULL DEFAULT 0,
  error_breakdown   jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_runs_entity_started_idx ON app.sync_runs (entity, started_at DESC);

-- Async CSV export jobs: requestExport inserts 'pending', the worker flips it.
CREATE TABLE IF NOT EXISTS app.export_jobs (
  id                 text PRIMARY KEY,            -- exp_*
  requested_by_sub   text NOT NULL,
  requested_by_role  text,
  requested_by_admin boolean NOT NULL DEFAULT false,
  surface            text NOT NULL,               -- which list view
  filter             jsonb NOT NULL DEFAULT '{}',
  status             text NOT NULL DEFAULT 'pending', -- pending / running / done / error
  s3_key             text,
  row_count          integer,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);
CREATE INDEX IF NOT EXISTS export_jobs_requester_idx ON app.export_jobs (requested_by_sub, created_at);

-- In-app notifications; idempotent per (recipient, kind, source).
CREATE TABLE IF NOT EXISTS app.notifications (
  id               text PRIMARY KEY,
  recipient_email  text        NOT NULL,
  kind             text        NOT NULL,
  title            text        NOT NULL,
  body             text,
  href             text        NOT NULL,
  source_id        text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  read_at          timestamptz,
  UNIQUE (recipient_email, kind, source_id)
);
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON app.notifications (recipient_email, created_at DESC)
  WHERE read_at IS NULL;

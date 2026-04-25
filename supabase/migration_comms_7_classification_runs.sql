-- ============================================================
-- Comms Intelligence — Migration 7: Classification Runs
-- SAFE: Purely additive. Idempotent. Re-runnable.
-- ============================================================
-- One row per classify-pending cron tick (or manual batch).
-- Parallels ingestion_runs but scoped to the classifier.
--
-- Used by:
--   /api/comms-cron/classify-pending   — scheduled sweeper
--   /api/communications/classify       — manual / ad-hoc batch
--
-- Cost metadata (tokens_in/tokens_out/cost_inr) is best-effort:
-- the Gemini REST path does not return token counts in a form
-- we currently parse, so values may be NULL until we plumb it
-- through lib/aiClient.js. Leaving the columns nullable means
-- we can start recording them later without another migration.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS classification_runs (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at               timestamptz NOT NULL DEFAULT now(),
  completed_at             timestamptz,
  trigger                  text        NOT NULL DEFAULT 'cron',  -- 'cron' | 'manual' | 'retry'
  messages_attempted       integer     NOT NULL DEFAULT 0,
  messages_successful      integer     NOT NULL DEFAULT 0,
  messages_failed          integer     NOT NULL DEFAULT 0,
  messages_skipped         integer     NOT NULL DEFAULT 0,
  error_message            text,
  provider_primary         text,       -- e.g. 'gemini'
  provider_fallback_used   integer     NOT NULL DEFAULT 0,  -- count of Claude fallbacks
  tokens_in                integer,    -- best-effort; may be NULL
  tokens_out               integer,    -- best-effort; may be NULL
  cost_inr                 numeric(10,4),
  triggered_by             text        -- 'auto' | user email for manual runs
);

CREATE INDEX IF NOT EXISTS classification_runs_started_idx
  ON classification_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS classification_runs_trigger_idx
  ON classification_runs (trigger, started_at DESC);

COMMIT;

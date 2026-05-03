-- ============================================================
-- Comms Intelligence — Migration 9: Human-First Triage support
-- SAFE: Purely additive. Idempotent. Re-runnable.
-- ============================================================
-- Adds the schema needed for the Stage 3 redesign:
--
-- 1. New ENUM value 'dismissed' on message_status — for messages
--    a human marked as "not relevant / skip".
--
-- 2. New columns on inbox_messages tracking the human triage:
--    triaged_by, triaged_at      — who categorised + when
--    dismissed_by, dismissed_at  — who skipped + when
--    dismiss_reason              — optional free-text reason
--
-- 3. New ai_call_log table — one row per OCR or LLM call. Provider,
--    model, tokens/pages, INR cost estimate, latency, fallback flag.
--    Enables a future "AI cost dashboard" without re-querying every
--    classification_runs/extraction_results row.
--
-- Stage 3a is plumbing only — no code reads/writes these new
-- columns/tables yet. Stage 3b (triage UI) and Stage 3c (extractor
-- cron) will start populating them.
-- ============================================================

-- ------------------------------------------------------------
-- 1. New ENUM value: dismissed
-- ALTER TYPE ... ADD VALUE must run as a single statement
-- (not inside a transaction block in older Postgres). Postgres 12+
-- supports IF NOT EXISTS to make this idempotent.
-- ------------------------------------------------------------
ALTER TYPE message_status ADD VALUE IF NOT EXISTS 'dismissed';

-- ------------------------------------------------------------
-- 2. Triage tracking columns on inbox_messages
-- ------------------------------------------------------------
ALTER TABLE inbox_messages
  ADD COLUMN IF NOT EXISTS triaged_by      text,
  ADD COLUMN IF NOT EXISTS triaged_at      timestamptz,
  ADD COLUMN IF NOT EXISTS dismissed_by    text,
  ADD COLUMN IF NOT EXISTS dismissed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS dismiss_reason  text;

-- Triage-queue partial index — keys off 'received' which is an existing
-- ENUM value, so Postgres lets us use it in a partial predicate here.
CREATE INDEX IF NOT EXISTS inbox_messages_triage_queue_idx
  ON inbox_messages (company, status, received_at DESC)
  WHERE status = 'received';

-- Dismissed-messages index. NOTE: we deliberately do NOT use a
-- `WHERE status = 'dismissed'` partial predicate here because Postgres
-- 55P04 forbids using a new ENUM value in the same transaction that
-- created it. A non-partial index on dismissed_at covers our query
-- patterns (WHERE dismissed_at IS NOT NULL ORDER BY dismissed_at DESC)
-- because dismissed_at is NULL for non-dismissed rows, so the index
-- only carries meaningful entries anyway.
CREATE INDEX IF NOT EXISTS inbox_messages_dismissed_idx
  ON inbox_messages (company, dismissed_at DESC);

-- ------------------------------------------------------------
-- 3. ai_call_log — one row per OCR / LLM call
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_call_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           text        NOT NULL,                            -- 'ocr' | 'llm'
  provider        text        NOT NULL,                            -- 'claude' | 'gemini' | 'mistral_ocr' | 'textract' | future
  model           text,                                            -- e.g. 'claude-sonnet-4-5-20250929', 'mistral-ocr-2503'
  message_id      uuid        REFERENCES inbox_messages(id) ON DELETE CASCADE,
  attachment_id   uuid        REFERENCES message_attachments(id) ON DELETE SET NULL,
  triggered_by    text        NOT NULL DEFAULT 'auto',             -- 'auto' | 'manual:<email>'
  tokens_in       integer,                                         -- LLM only
  tokens_out      integer,                                         -- LLM only
  pages           integer,                                         -- OCR only
  cost_inr        numeric(12,6),                                   -- best-effort estimate
  latency_ms      integer,
  is_fallback     boolean     NOT NULL DEFAULT false,              -- true if primary provider failed and we fell through
  error_message   text,                                            -- non-null when the call ultimately failed
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_call_log_message_idx
  ON ai_call_log (message_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_call_log_scope_provider_idx
  ON ai_call_log (scope, provider, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_call_log_recent_idx
  ON ai_call_log (created_at DESC);

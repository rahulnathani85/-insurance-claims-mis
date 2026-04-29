-- ============================================================
-- Comms Intelligence — Migration 5: gmail_tokens additive
-- SAFE: Purely additive. Idempotent.
-- ============================================================
-- Adds three columns to the existing gmail_tokens table so the
-- Communications module can share the same token storage:
--
--   is_comms_mailbox  — true when this row is a shared mailbox
--                       owned by the Comms module (e.g. the
--                       NISLA claim.intimation inbox)
--   is_comms_opted_in — true when a user has opted in their
--                       own Gmail as a secondary Comms source
--   company           — which tenant this mailbox belongs to
--                       (required when either flag is true)
--
-- Existing per-user Gmail code paths filter purely by
-- user_email, so they are unaffected by the new columns.
-- ============================================================

BEGIN;

ALTER TABLE gmail_tokens
  ADD COLUMN IF NOT EXISTS is_comms_mailbox  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_comms_opted_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS company           text;

-- Partial index to make cron polling cheap: only rows that
-- actually need to be scanned by the Comms ingestor.
CREATE INDEX IF NOT EXISTS gmail_tokens_comms_active_idx
  ON gmail_tokens (is_comms_mailbox, is_comms_opted_in, company)
  WHERE is_comms_mailbox = true OR is_comms_opted_in = true;

COMMIT;

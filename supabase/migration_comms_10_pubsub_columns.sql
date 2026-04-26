-- ============================================================
-- Comms Intelligence — Migration 10: Pub/Sub Push columns
-- SAFE: Purely additive. Idempotent.
-- ============================================================
-- Stage 4 — Gmail Push ingestion via Cloud Pub/Sub.
--
-- Adds two columns on gmail_tokens:
--
--   last_history_id      bigint
--     The last historyId we successfully processed for this
--     mailbox. Push delivers a "something changed" notification
--     with a NEW historyId; we then call users.history.list from
--     last_history_id to discover which messages were added.
--
--   watch_expires_at     timestamptz
--     Gmail watch subscriptions expire after 7 days. We renew
--     daily via /api/comms-cron/refresh-watch. This column tracks
--     when each mailbox's current watch is set to expire so the
--     refresh cron can prioritise the closest-to-expiry rows.
-- ============================================================

ALTER TABLE gmail_tokens
  ADD COLUMN IF NOT EXISTS last_history_id   bigint,
  ADD COLUMN IF NOT EXISTS watch_expires_at  timestamptz;

CREATE INDEX IF NOT EXISTS gmail_tokens_watch_expires_idx
  ON gmail_tokens (watch_expires_at)
  WHERE is_comms_mailbox = true OR is_comms_opted_in = true;

-- ============================================================
-- migration_comms_15_intake_metadata.sql
-- ------------------------------------------------------------
-- Adds fallback-identity columns to claims so that an intimation
-- can be auto-created even when the LLM extraction misses
-- policy_no / insured_name. The originating email's sender and
-- received-at timestamp are always available, so we store them
-- on the claim row as the identity-of-last-resort. UI uses these
-- when insured_name is NULL.
--
-- All columns are nullable so legacy rows are unaffected.
-- ============================================================

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS intake_email_from TEXT,
  ADD COLUMN IF NOT EXISTS intake_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_message_id UUID REFERENCES inbox_messages(id);

CREATE INDEX IF NOT EXISTS idx_claims_intake_message_id
  ON claims (intake_message_id)
  WHERE intake_message_id IS NOT NULL;

-- ============================================================
-- migration_comms_12_email_drafts.sql
-- AI-generated reply drafts for inbox messages.
--
-- The auto-routing executor's draft_reply action populates a row
-- here. The triage UI shows the draft, lets the human edit and
-- mark it as sent (manual send via Gmail for now; full Gmail-API
-- send is a later iteration).
-- ============================================================

CREATE TABLE IF NOT EXISTS email_drafts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
  claim_id        BIGINT REFERENCES claims(id),
  to_address      TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  body_edited     TEXT,                       -- non-null if human edited
  generated_by    TEXT NOT NULL DEFAULT 'auto',
  llm_provider    TEXT,
  llm_model       TEXT,
  llm_tokens_in   INTEGER,
  llm_tokens_out  INTEGER,
  llm_cost_inr    NUMERIC(10, 6),
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'sent', 'discarded')),
  sent_at         TIMESTAMPTZ,
  sent_by         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_drafts_message_id ON email_drafts(message_id);
CREATE INDEX IF NOT EXISTS idx_email_drafts_claim_id ON email_drafts(claim_id);
CREATE INDEX IF NOT EXISTS idx_email_drafts_status ON email_drafts(status);

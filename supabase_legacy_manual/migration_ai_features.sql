-- ============================================================
-- Migration: AI Document Analyser + FSR Generator
-- SAFE: Purely additive. No existing data modified.
-- ============================================================

BEGIN;

-- AI conversation history per claim
CREATE TABLE IF NOT EXISTS claim_ai_conversations (
  id bigserial PRIMARY KEY,
  claim_id bigint NOT NULL,
  role text NOT NULL,
  message text NOT NULL,
  created_by text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_conv_claim ON claim_ai_conversations(claim_id);
CREATE INDEX IF NOT EXISTS idx_ai_conv_created ON claim_ai_conversations(created_at);

-- AI-generated FSR drafts
CREATE TABLE IF NOT EXISTS claim_fsr_drafts (
  id bigserial PRIMARY KEY,
  claim_id bigint NOT NULL,
  lob text,
  draft_content text,
  status text DEFAULT 'draft',
  version_number int DEFAULT 1,
  generated_at timestamptz DEFAULT now(),
  approved_by text,
  approved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_fsr_drafts_claim ON claim_fsr_drafts(claim_id);

COMMIT;

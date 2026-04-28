-- ============================================================
-- Migration: 9-Stage Claim Pipeline + TAT Tracking
-- SAFE: Purely additive. No existing tables or data modified.
-- ============================================================

BEGIN;

-- 1. Add columns to existing claim_stages table
ALTER TABLE claim_stages ADD COLUMN IF NOT EXISTS stage_number INTEGER;
ALTER TABLE claim_stages ADD COLUMN IF NOT EXISTS entered_by TEXT;
ALTER TABLE claim_stages ADD COLUMN IF NOT EXISTS company TEXT DEFAULT 'NISLA';

-- 2. Add pipeline cache columns to claims table
ALTER TABLE claims ADD COLUMN IF NOT EXISTS pipeline_stage TEXT DEFAULT 'Pending Assignment';
ALTER TABLE claims ADD COLUMN IF NOT EXISTS pipeline_stage_number INTEGER DEFAULT 1;

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_claim_stages_claim_id ON claim_stages(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_stages_stage_number ON claim_stages(stage_number);
CREATE INDEX IF NOT EXISTS idx_claims_pipeline_stage ON claims(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_claims_pipeline_stage_number ON claims(pipeline_stage_number);

-- 4. Backfill existing claims: set pipeline_stage based on current status
UPDATE claims SET
  pipeline_stage = CASE
    WHEN status = 'Submitted' THEN 'Report Submitted'
    WHEN status = 'In Process' THEN 'Under Assessment'
    ELSE 'Pending Assignment'
  END,
  pipeline_stage_number = CASE
    WHEN status = 'Submitted' THEN 8
    WHEN status = 'In Process' THEN 5
    ELSE 1
  END
WHERE pipeline_stage IS NULL OR pipeline_stage = 'Pending Assignment';

COMMIT;

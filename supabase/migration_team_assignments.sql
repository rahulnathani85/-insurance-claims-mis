-- ============================================================
-- Migration: Enhanced Team Assignment Module
-- SAFE: Purely additive. No existing data modified.
-- ============================================================

BEGIN;

-- New columns on claim_assignments
ALTER TABLE claim_assignments ADD COLUMN IF NOT EXISTS assignment_type TEXT DEFAULT 'general';
ALTER TABLE claim_assignments ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'Normal';
ALTER TABLE claim_assignments ADD COLUMN IF NOT EXISTS assignment_basis TEXT;
ALTER TABLE claim_assignments ADD COLUMN IF NOT EXISTS location_of_loss TEXT;
ALTER TABLE claim_assignments ADD COLUMN IF NOT EXISTS target_inspection_date DATE;
ALTER TABLE claim_assignments ADD COLUMN IF NOT EXISTS target_report_date DATE;
ALTER TABLE claim_assignments ADD COLUMN IF NOT EXISTS reassignment_reason TEXT;
ALTER TABLE claim_assignments ADD COLUMN IF NOT EXISTS assigned_to_name TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_claim_assignments_type ON claim_assignments(assignment_type);
CREATE INDEX IF NOT EXISTS idx_claim_assignments_priority ON claim_assignments(priority);
CREATE INDEX IF NOT EXISTS idx_claim_assignments_assigned_to ON claim_assignments(assigned_to);

-- Backfill: Set existing assignments to 'general' type and denormalize names
UPDATE claim_assignments SET assignment_type = 'general' WHERE assignment_type IS NULL;

COMMIT;

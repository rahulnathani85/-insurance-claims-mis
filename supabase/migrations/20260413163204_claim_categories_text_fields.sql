-- ============================================================
-- Add denormalized text columns for cause_of_loss and subject_matter
-- So they display in MIS/reports without joins
-- Run AFTER migration_claim_categories.sql
-- ============================================================

ALTER TABLE claims ADD COLUMN IF NOT EXISTS cause_of_loss text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS subject_matter text;

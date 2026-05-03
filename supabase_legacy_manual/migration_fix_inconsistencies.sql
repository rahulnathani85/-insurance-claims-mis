-- ============================================================
-- Migration: Fix Data Inconsistencies
-- Run this in Supabase SQL Editor
-- ============================================================

BEGIN;

-- FIX 3: claim_assignments date columns from text to date
ALTER TABLE claim_assignments
  ALTER COLUMN assigned_date TYPE date USING NULLIF(assigned_date, '')::date;
ALTER TABLE claim_assignments
  ALTER COLUMN due_date TYPE date USING NULLIF(due_date, '')::date;
ALTER TABLE claim_assignments
  ALTER COLUMN completed_date TYPE date USING NULLIF(completed_date, '')::date;

-- FIX 2: Rename claims.date_intimation to date_of_intimation
ALTER TABLE claims RENAME COLUMN date_intimation TO date_of_intimation;

-- FIX 1: 3-Office Insurer Model
-- claims table
ALTER TABLE claims ADD COLUMN IF NOT EXISTS appointing_office_id bigint;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS appointing_office_name text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS appointing_office_address text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS policy_office_id bigint;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS policy_office_name text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS policy_office_address text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS fsr_office_id bigint;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS fsr_office_name text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS fsr_office_address text;

-- ew_vehicle_claims table
ALTER TABLE ew_vehicle_claims ADD COLUMN IF NOT EXISTS appointing_office_id bigint;
ALTER TABLE ew_vehicle_claims ADD COLUMN IF NOT EXISTS appointing_office_name text;
ALTER TABLE ew_vehicle_claims ADD COLUMN IF NOT EXISTS appointing_office_address text;
ALTER TABLE ew_vehicle_claims ADD COLUMN IF NOT EXISTS policy_office_id bigint;
ALTER TABLE ew_vehicle_claims ADD COLUMN IF NOT EXISTS policy_office_name text;
ALTER TABLE ew_vehicle_claims ADD COLUMN IF NOT EXISTS policy_office_address text;
ALTER TABLE ew_vehicle_claims ADD COLUMN IF NOT EXISTS fsr_office_id bigint;
ALTER TABLE ew_vehicle_claims ADD COLUMN IF NOT EXISTS fsr_office_name text;
ALTER TABLE ew_vehicle_claims ADD COLUMN IF NOT EXISTS fsr_office_address text;

-- Migrate existing insurer data to appointing_office
UPDATE claims SET appointing_office_name = insurer_name, appointing_office_address = insurer_address
WHERE insurer_name IS NOT NULL AND appointing_office_name IS NULL;

UPDATE ew_vehicle_claims SET appointing_office_name = insurer_name, appointing_office_address = insurer_address
WHERE insurer_name IS NOT NULL AND appointing_office_name IS NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_claims_appointing_office ON claims(appointing_office_id);
CREATE INDEX IF NOT EXISTS idx_claims_policy_office ON claims(policy_office_id);
CREATE INDEX IF NOT EXISTS idx_claims_fsr_office ON claims(fsr_office_id);
CREATE INDEX IF NOT EXISTS idx_ew_appointing_office ON ew_vehicle_claims(appointing_office_id);
CREATE INDEX IF NOT EXISTS idx_ew_policy_office ON ew_vehicle_claims(policy_office_id);
CREATE INDEX IF NOT EXISTS idx_ew_fsr_office ON ew_vehicle_claims(fsr_office_id);

COMMIT;

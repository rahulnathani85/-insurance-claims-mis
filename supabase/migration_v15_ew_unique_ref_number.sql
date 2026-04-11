-- ============================================================
-- Migration v15: Enforce unique reference numbers for EW claims
-- ============================================================
-- Problem: EW Vehicle Claims list can show the same ref_number
-- twice because there is no UNIQUE constraint on ref_number in
-- ew_vehicle_claims. This migration:
--   1. Removes duplicate rows (keeps the OLDEST one per company+ref)
--   2. Adds a UNIQUE constraint on (company, ref_number)
--   3. Adds an index for faster lookups
-- ============================================================

-- STEP 1: Inspect duplicates first (read-only, safe to run)
-- Uncomment to review before deleting:
-- SELECT company, ref_number, COUNT(*) AS cnt, array_agg(id ORDER BY created_at) AS ids
-- FROM ew_vehicle_claims
-- GROUP BY company, ref_number
-- HAVING COUNT(*) > 1;

-- STEP 2: Delete duplicates, keeping the earliest-created row for each (company, ref_number)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY company, ref_number
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM ew_vehicle_claims
  WHERE ref_number IS NOT NULL
)
DELETE FROM ew_vehicle_claims
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- STEP 3: Add UNIQUE constraint on (company, ref_number)
-- Multi-tenant safe: NISLA EW-0001/26-27 and Acuere EW-0001/26-27 can coexist,
-- but two EW-0001/26-27 rows for the same company are now impossible.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ew_vehicle_claims_company_ref_unique'
  ) THEN
    ALTER TABLE ew_vehicle_claims
      ADD CONSTRAINT ew_vehicle_claims_company_ref_unique
      UNIQUE (company, ref_number);
  END IF;
END $$;

-- STEP 4: Index for quick lookups when generating the next counter value
CREATE INDEX IF NOT EXISTS idx_ew_vehicle_claims_ref_number
  ON ew_vehicle_claims (company, ref_number);

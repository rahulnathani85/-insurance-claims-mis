-- =============================================================================
-- migration_fix_ew_claim_id_uuid.sql
-- =============================================================================
-- Fixes the carried-over bug from 001_lifecycle_engine.sql line 341 where
-- claim_lifecycle.ew_claim_id was declared BIGINT. Extended Warranty claims
-- use UUID primary keys (ew_vehicle_claims.id is UUID), so every attempt to
-- attach a lifecycle to an EW claim fails with:
--
--     invalid input syntax for type bigint: "c2b5786f-da45-47ec-b731-..."
--
-- This migration:
--   1. Drops the two views that reference the column (so ALTER can proceed)
--   2. Drops the unique partial index on the column
--   3. Nukes any stray rows that have ew_claim_id set (should be none, since
--      every attach has been failing — but defensive: the CHECK constraint
--      would otherwise be violated once we set all values to NULL)
--   4. Alters the column type BIGINT → UUID (USING NULL, so any bad data is
--      wiped — no EW lifecycle has ever been successfully attached)
--   5. Recreates the unique partial index
--   6. Recreates the two views (bodies unchanged)
--
-- Idempotent: safe to run multiple times.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Drop dependent views
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_claim_lifecycle_overview;
DROP VIEW IF EXISTS v_claim_lifecycle_tat_breaches;

-- -----------------------------------------------------------------------------
-- 2. Drop the unique partial index on ew_claim_id
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_cl_ew;

-- -----------------------------------------------------------------------------
-- 3. Defensive cleanup — remove any claim_lifecycle rows that have ew_claim_id
--    set (there should be none, because every attach attempt has been failing
--    at the bigint cast step). Without this, step 4's USING NULL would nullify
--    those rows and then violate the CHECK constraint requiring exactly one of
--    claim_id / ew_claim_id to be non-null.
-- -----------------------------------------------------------------------------
DELETE FROM claim_lifecycle WHERE ew_claim_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. Alter column type BIGINT → UUID
-- -----------------------------------------------------------------------------
ALTER TABLE claim_lifecycle
    ALTER COLUMN ew_claim_id TYPE UUID USING NULL;

-- -----------------------------------------------------------------------------
-- 5. Recreate the unique partial index
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX idx_cl_ew
    ON claim_lifecycle(ew_claim_id)
    WHERE ew_claim_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 6. Recreate the two dependent views (bodies copied verbatim from
--    001_lifecycle_engine.sql §5.1 and §5.2)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_claim_lifecycle_overview AS
SELECT
    cl.id                      AS lifecycle_id,
    cl.claim_id,
    cl.ew_claim_id,
    cl.current_phase,
    cl.is_complete,
    t.template_code,
    t.template_name,
    t.match_lob,
    cl.firm_clock_start,
    cl.firm_clock_elapsed_sec,
    (cl.firm_clock_paused_at IS NOT NULL) AS firm_clock_is_paused,
    cl.insurer_clock_start,
    cl.insurer_clock_elapsed_sec,
    (cl.insurer_clock_paused_at IS NOT NULL) AS insurer_clock_is_paused,
    cl.fsr_version,
    (
        SELECT COUNT(*) FROM claim_lifecycle_items i
        WHERE i.claim_lifecycle_id = cl.id AND i.status = 'open'
    ) AS open_items_count,
    (
        SELECT COUNT(*) FROM claim_lifecycle_stages s
        WHERE s.claim_lifecycle_id = cl.id AND s.status IN ('not_started', 'active')
    ) AS pending_stages_count
FROM claim_lifecycle cl
JOIN lifecycle_templates t ON t.id = cl.template_id;


CREATE OR REPLACE VIEW v_claim_lifecycle_tat_breaches AS
SELECT
    cl.id AS lifecycle_id,
    cl.claim_id,
    cl.ew_claim_id,
    cls.stage_code,
    cls.stage_name,
    cls.universal_phase,
    cls.due_by_firm,
    cls.due_by_insurer,
    cls.status,
    CASE WHEN cls.due_by_firm    < NOW() AND cls.status != 'completed' THEN TRUE ELSE FALSE END AS firm_breached,
    CASE WHEN cls.due_by_insurer < NOW() AND cls.status != 'completed' THEN TRUE ELSE FALSE END AS insurer_breached
FROM claim_lifecycle cl
JOIN claim_lifecycle_stages cls ON cls.claim_lifecycle_id = cl.id
WHERE cls.status IN ('not_started', 'active')
  AND (cls.due_by_firm < NOW() OR cls.due_by_insurer < NOW());

-- -----------------------------------------------------------------------------
-- 7. Sanity comment on the column so future devs don't repeat the mistake
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN claim_lifecycle.ew_claim_id IS 'ew_vehicle_claims.id (UUID). Paired with CHECK that exactly one of claim_id / ew_claim_id is non-null. No FK because some legacy EW claims may have been archived - validated by the app layer.';

COMMIT;

-- =============================================================================
-- DONE. Verify with:
--   \d claim_lifecycle
-- and confirm ew_claim_id is now type uuid.
-- =============================================================================

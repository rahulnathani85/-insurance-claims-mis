-- =============================================================================
-- Surveyors module — IRDAI license tracking + conflict-of-interest foundations
-- =============================================================================
-- 30 Apr 2026
--
-- The `surveyors` table existed (legacy backfill in 20260429210000) but only
-- carried name/designation/phone/email — none of the regulatory fields IRDAI
-- mandates per CLAUDE.md §13. This migration:
--
--   1. Extends `surveyors` with license_number, license_category,
--      license_issued_date, license_expiry_date, peril_specialties (text[]),
--      region, pan, gstin, address, max_concurrent_claims, notes.
--   2. Adds a unique partial index on license_number (multiple NULLs allowed
--      while old rows are being backfilled).
--   3. Adds an index on license_expiry_date for the expiry-warning queries the
--      master page + assignment ranking will run.
--   4. Adds a CHECK constraint on license_category.
--   5. Creates `surveyor_conflicts` to declare conflicts of interest per
--      insurer/insured/broker. The assignment ranking (Slice F) will read this
--      to block conflicted assignments per spec §7.
--
-- All additions are idempotent (IF NOT EXISTS / DO blocks). Re-running the
-- migration is a no-op.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Surveyors: license + classification columns
-- -----------------------------------------------------------------------------

ALTER TABLE public.surveyors ADD COLUMN IF NOT EXISTS license_number        TEXT;
ALTER TABLE public.surveyors ADD COLUMN IF NOT EXISTS license_category      TEXT;
ALTER TABLE public.surveyors ADD COLUMN IF NOT EXISTS license_issued_date   DATE;
ALTER TABLE public.surveyors ADD COLUMN IF NOT EXISTS license_expiry_date   DATE;
ALTER TABLE public.surveyors ADD COLUMN IF NOT EXISTS peril_specialties     TEXT[];
ALTER TABLE public.surveyors ADD COLUMN IF NOT EXISTS region                TEXT;
ALTER TABLE public.surveyors ADD COLUMN IF NOT EXISTS pan                   TEXT;
ALTER TABLE public.surveyors ADD COLUMN IF NOT EXISTS gstin                 TEXT;
ALTER TABLE public.surveyors ADD COLUMN IF NOT EXISTS address               TEXT;
ALTER TABLE public.surveyors ADD COLUMN IF NOT EXISTS max_concurrent_claims INTEGER;
ALTER TABLE public.surveyors ADD COLUMN IF NOT EXISTS notes                 TEXT;
ALTER TABLE public.surveyors ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ DEFAULT NOW();

-- license_category controlled vocabulary — IRDAI Surveyors & Loss Assessors
-- Regulations 2015 distinguish Category A / Category B and Fellow / Associate.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'surveyors_license_category_check'
    ) THEN
        ALTER TABLE public.surveyors
            ADD CONSTRAINT surveyors_license_category_check
            CHECK (license_category IS NULL OR license_category IN ('A', 'B', 'Fellow', 'Associate'));
    END IF;
END $$;

-- Unique license_number across active rows. Partial so we can backfill legacy
-- rows that don't yet have one without conflict.
CREATE UNIQUE INDEX IF NOT EXISTS uq_surveyors_license_number
    ON public.surveyors (license_number)
    WHERE license_number IS NOT NULL;

-- Speeds up "expiring within N days" queries on the master page and ranking.
CREATE INDEX IF NOT EXISTS idx_surveyors_license_expiry
    ON public.surveyors (license_expiry_date)
    WHERE active = true;

COMMENT ON COLUMN public.surveyors.license_number
    IS 'IRDAI license number (e.g. IRDAI/CORP/SLA-200025). Required for assignment per spec §7.';
COMMENT ON COLUMN public.surveyors.license_category
    IS 'IRDAI category: A / B / Fellow / Associate (Regulations 2015).';
COMMENT ON COLUMN public.surveyors.license_expiry_date
    IS 'License expiry. Assignment is blocked if expired or expiring <30 days (spec §7, §10).';
COMMENT ON COLUMN public.surveyors.peril_specialties
    IS 'Peril types the surveyor is licensed for (Fire, Marine Cargo, Engineering...). Filters assignment suggestions.';
COMMENT ON COLUMN public.surveyors.region
    IS 'Primary operating region (West / North / South / East / Central or city). Used for region-match ranking.';

-- -----------------------------------------------------------------------------
-- 2. Conflict-of-interest declarations
-- -----------------------------------------------------------------------------
-- Used by Slice F (assignment) to block a surveyor being assigned to a claim
-- whose insurer/insured/broker matches a declared conflict.

CREATE TABLE IF NOT EXISTS public.surveyor_conflicts (
    id              BIGSERIAL PRIMARY KEY,
    surveyor_id     UUID        NOT NULL REFERENCES public.surveyors(id) ON DELETE CASCADE,
    conflict_type   TEXT        NOT NULL,
    conflict_value  TEXT        NOT NULL,
    notes           TEXT,
    declared_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    declared_by     TEXT
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'surveyor_conflicts_type_check'
    ) THEN
        ALTER TABLE public.surveyor_conflicts
            ADD CONSTRAINT surveyor_conflicts_type_check
            CHECK (conflict_type IN ('insurer', 'insured', 'broker'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_surveyor_conflicts_surveyor
    ON public.surveyor_conflicts (surveyor_id);
CREATE INDEX IF NOT EXISTS idx_surveyor_conflicts_value_lower
    ON public.surveyor_conflicts (LOWER(conflict_value));

ALTER TABLE public.surveyor_conflicts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'surveyor_conflicts'
          AND policyname = 'Allow all access to surveyor_conflicts'
    ) THEN
        CREATE POLICY "Allow all access to surveyor_conflicts" ON public.surveyor_conflicts
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.surveyor_conflicts
    IS 'Spec §7: declared conflicts of interest. Assignment ranking blocks a surveyor whose declared conflict_value matches the claim insurer / insured / broker (case-insensitive).';

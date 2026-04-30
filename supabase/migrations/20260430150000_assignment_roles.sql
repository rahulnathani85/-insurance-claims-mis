-- =============================================================================
-- Slice F: claim_assignments — surveyor_id + role enum (registration spec §7)
-- =============================================================================
-- 30 Apr 2026
--
-- Existing claim_assignments stores `assigned_to` (text email) for legacy
-- compatibility. Slice F introduces:
--   1. surveyor_id (UUID, nullable) — FK to public.surveyors so the ranking
--      / conflict-check logic can join licence + specialty + conflicts.
--      Rows that come from the legacy app_users path keep assigned_to NULL
--      surveyor_id.
--   2. role check — controlled vocabulary per spec §7 + §19.
--
-- All additions are idempotent. Existing rows are unaffected.
-- =============================================================================

ALTER TABLE public.claim_assignments
    ADD COLUMN IF NOT EXISTS surveyor_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'claim_assignments_surveyor_fk'
    ) THEN
        ALTER TABLE public.claim_assignments
            ADD CONSTRAINT claim_assignments_surveyor_fk
            FOREIGN KEY (surveyor_id) REFERENCES public.surveyors(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_claim_assignments_surveyor_id
    ON public.claim_assignments (surveyor_id)
    WHERE surveyor_id IS NOT NULL;

-- Spec §7 / §19 — controlled assignment roles. The legacy 'Surveyor' default
-- on POST is grandfathered in; new rows from the team-assign endpoint use the
-- snake_case roles below.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'claim_assignments_role_check'
    ) THEN
        ALTER TABLE public.claim_assignments
            ADD CONSTRAINT claim_assignments_role_check
            CHECK (role IS NULL OR role IN (
                -- legacy values (pre-Slice F) — kept so existing rows pass
                'Surveyor', 'Co-Surveyor', 'Reviewer', 'Engineer', 'Manager', 'Observer',
                -- canonical Slice F values (registration spec §7, §19)
                'lead_surveyor', 'co_surveyor', 'engineer', 'ca', 'manager', 'observer'
            ));
    END IF;
END $$;

COMMENT ON COLUMN public.claim_assignments.surveyor_id
    IS 'Spec §7: FK to public.surveyors. Set when the assignment was made via the surveyor master (license-aware ranking + conflict check). NULL for legacy app_users-based assignments.';

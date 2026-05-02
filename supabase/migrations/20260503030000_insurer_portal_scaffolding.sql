-- =============================================================================
-- 20260503030000_insurer_portal_scaffolding.sql
-- =============================================================================
-- CLAUDE.md §11 #8 — Insurer read-only portal scaffolding.
--
-- THIS MIGRATION DOES NOT ENABLE THE INSURER PORTAL YET. It only adds the
-- nullable columns + helper indexes that the future work will build on.
-- Existing surveyor flows are entirely unaffected because:
--
--   - Every new column is NULLable.
--   - The role-check constraint is permissive — existing rows keep their
--     'Admin' / 'Staff' / 'Surveyor' role values.
--   - No RLS policies are added or changed here. RLS tightening is a
--     separate cross-cutting concern that requires every API route to
--     be audited first (some currently rely on permissive `USING (true)`).
--
-- Future work tracked in `docs/insurer-portal-rls-spec.md`. The phased
-- migration there is:
--
--   Phase 1 (THIS MIGRATION): add the column shape so insurer rows can
--           be created + identified. No behavioural change for surveyors.
--   Phase 2 (next slice):     port the login flow to recognise role =
--           'insurer_readonly' and redirect those users to an
--           insurer-scoped dashboard route. RLS still permissive.
--   Phase 3 (later):          enable per-table RLS that filters claims +
--           related rows by insurer_id from the JWT / session claim. By
--           this point every API route that surveyors hit must have
--           been audited to ensure they pass the right context.
--   Phase 4 (later):          drop permissive `Allow all access` RLS
--           policies and replace with role-aware ones across the schema.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. app_users — link an insurer-role user to their insurer row
-- -----------------------------------------------------------------------------

ALTER TABLE public.app_users
    ADD COLUMN IF NOT EXISTS insurer_id BIGINT REFERENCES public.insurers(id);

COMMENT ON COLUMN public.app_users.insurer_id
    IS 'Set ONLY for users with role = ''insurer_readonly''. Null for every NISLA / Acuere internal user. Future RLS policies will use this column to filter claims to those where claims.insurer_name matches insurers.name (or once provenance settles, claim_field_values rows tagged for that insurer).';

-- -----------------------------------------------------------------------------
-- 2. Role check — extend the implicit enum to include insurer_readonly
-- -----------------------------------------------------------------------------
-- The original schema (V5 migration) used a bare TEXT column with a default
-- but no CHECK constraint. We add one now so future code can rely on the
-- role being one of a known set.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_users_role_check') THEN
        ALTER TABLE public.app_users
            ADD CONSTRAINT app_users_role_check
            CHECK (role IN (
                'Admin',
                'Manager',
                'Surveyor',
                'Co-Surveyor',
                'Engineer',
                'CA',
                'Inward Clerk',
                'Staff',
                'Read Only',
                'insurer_readonly'  -- new in Phase 1
            ));
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Insurer-portal integrity check
-- -----------------------------------------------------------------------------
-- An insurer_readonly user MUST have an insurer_id. Surveyor / staff users
-- MUST NOT. Catches data-entry mistakes early.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_users_insurer_role_pairing') THEN
        ALTER TABLE public.app_users
            ADD CONSTRAINT app_users_insurer_role_pairing
            CHECK (
                (role = 'insurer_readonly' AND insurer_id IS NOT NULL) OR
                (role <> 'insurer_readonly' AND insurer_id IS NULL)
            );
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Index for the (future) RLS predicate's hot path
-- -----------------------------------------------------------------------------
-- Phase 3 RLS policies will filter claims by joining app_users.insurer_id
-- with insurers.name → claims.insurer_name. Indexing the linkage column
-- saves us a sequential scan on every claim-read.

CREATE INDEX IF NOT EXISTS idx_app_users_insurer_id
    ON public.app_users (insurer_id)
    WHERE insurer_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. Comment block for future implementers
-- -----------------------------------------------------------------------------

COMMENT ON CONSTRAINT app_users_role_check ON public.app_users
    IS 'Phase 1 of insurer portal — ''insurer_readonly'' is now a valid role. UI / API gating happens in lib/auth/insurer.js.';

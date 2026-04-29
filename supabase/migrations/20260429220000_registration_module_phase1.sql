-- =============================================================================
-- Registration module — Phase 1 (slices A + B + C from registration-module-spec.md)
-- =============================================================================
-- 29 Apr 2026
--
-- Adds the data-model foundations required by the registration spec:
--   §3 Data Model — adds complexity_tier, ila_due_at, fsr_due_at, is_catastrophe,
--      policy_period_from / policy_period_to to claims
--   §3 Data Model — extends activity_log with field-level diff columns
--      (field_name, old_value, new_value) instead of a separate claim_audit_log
--      table. Adds a Postgres trigger that auto-captures changed columns on
--      every UPDATE to claims.
--   §6 TAT — the new columns are populated at registration time by the
--      /api/claims/[id]/register endpoint (slice A logic in code).
--
-- Out of scope here (separate slices / migrations):
--   §5 Claim # format change to NISLA/YYYY/PERIL/REGION/SEQ — user opted to
--      keep the current SEQ/FY/LOB format
--   §7 Surveyor assignment ranking + conflict check — depends on surveyors
--      table being wired up first
--   §8 3-column form UX — separate slice E
--   §11 Notifications — separate slice G
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Claims: TAT + classification columns
-- -----------------------------------------------------------------------------

ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS complexity_tier      TEXT;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS ila_due_at           TIMESTAMPTZ;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS fsr_due_at           TIMESTAMPTZ;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS is_catastrophe       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS policy_period_from   DATE;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS policy_period_to     DATE;

-- complexity_tier is a controlled vocabulary; spec §6 lists 4 values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'claims_complexity_tier_check'
    ) THEN
        ALTER TABLE public.claims
            ADD CONSTRAINT claims_complexity_tier_check
            CHECK (complexity_tier IS NULL OR complexity_tier IN ('small', 'standard', 'large', 'cat'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_claims_ila_due_at ON public.claims (ila_due_at)
    WHERE ila_due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_claims_fsr_due_at ON public.claims (fsr_due_at)
    WHERE fsr_due_at IS NOT NULL;

COMMENT ON COLUMN public.claims.complexity_tier
    IS 'Spec §6: small (<1L) / standard (1L-50L) / large (50L-5Cr) / cat (>5Cr or linked to cat event). Drives FSR TAT.';
COMMENT ON COLUMN public.claims.ila_due_at
    IS 'Spec §6: registered_at + 72h. IRDAI-mandated. Set on registration.';
COMMENT ON COLUMN public.claims.fsr_due_at
    IS 'Spec §6: registered_at + tier days (30/30/45/90). Set on registration.';
COMMENT ON COLUMN public.claims.is_catastrophe
    IS 'Spec §6: forces complexity_tier=cat regardless of loss amount.';
COMMENT ON COLUMN public.claims.policy_period_from
    IS 'Spec §10: used for policy-period validation. Block registration if date_of_loss outside [policy_period_from, policy_period_to].';

-- -----------------------------------------------------------------------------
-- 2. Activity log: field-level diff columns (slice C)
-- -----------------------------------------------------------------------------

ALTER TABLE public.activity_log ADD COLUMN IF NOT EXISTS field_name TEXT;
ALTER TABLE public.activity_log ADD COLUMN IF NOT EXISTS old_value  JSONB;
ALTER TABLE public.activity_log ADD COLUMN IF NOT EXISTS new_value  JSONB;

COMMENT ON COLUMN public.activity_log.field_name
    IS 'Spec §3: name of the column whose value changed. Populated by claims_audit_trigger.';
COMMENT ON COLUMN public.activity_log.old_value
    IS 'Spec §3: previous value (jsonb-wrapped). Populated by claims_audit_trigger.';
COMMENT ON COLUMN public.activity_log.new_value
    IS 'Spec §3: new value (jsonb-wrapped). Populated by claims_audit_trigger.';

-- -----------------------------------------------------------------------------
-- 3. Postgres trigger — auto field-diff logging on claims UPDATE
-- -----------------------------------------------------------------------------
-- Captures every changed column on a claims UPDATE as a separate activity_log
-- row with action='claim_field_updated'. This is the regulatory IRDAI audit
-- trail. High-level user actions (e.g. action='claim_registered') continue to
-- be logged manually by API routes — both are useful.
--
-- IMPORTANT: 'updated_at' would fire this on every save, generating noise.
-- We exclude bookkeeping/timestamp columns from the diff.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_claim_field_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    excluded_cols TEXT[] := ARRAY[
        'created_at',          -- never changes
        'registered_at',       -- has a dedicated 'claim_registered' action
        'registered_by',
        'registration_note',
        'pipeline_stage',      -- redundant with stage_updated action
        'pipeline_stage_number'
    ];
    rec RECORD;
    old_val JSONB;
    new_val JSONB;
BEGIN
    FOR rec IN
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'claims'
          AND column_name <> ALL (excluded_cols)
    LOOP
        old_val := to_jsonb(OLD) -> rec.column_name;
        new_val := to_jsonb(NEW) -> rec.column_name;

        IF old_val IS DISTINCT FROM new_val THEN
            INSERT INTO public.activity_log (
                action,
                entity_type,
                entity_id,
                claim_id,
                ref_number,
                company,
                user_email,
                user_name,
                field_name,
                old_value,
                new_value
            ) VALUES (
                'claim_field_updated',
                'claim',
                NEW.id,             -- activity_log.entity_id is BIGINT, claims.id is BIGINT
                NEW.id,
                NEW.ref_number,
                NEW.company,
                COALESCE(current_setting('app.current_user_email', true), 'system'),
                COALESCE(current_setting('app.current_user_name', true), 'system'),
                rec.column_name,
                old_val,
                new_val
            );
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_claims_audit ON public.claims;
CREATE TRIGGER trg_claims_audit
AFTER UPDATE ON public.claims
FOR EACH ROW
EXECUTE FUNCTION public.log_claim_field_changes();

COMMENT ON FUNCTION public.log_claim_field_changes()
    IS 'Spec §3: per-field audit on claims UPDATE. Sets app.current_user_email / app.current_user_name from session if available, else "system". Excludes timestamp/bookkeeping columns to reduce noise.';

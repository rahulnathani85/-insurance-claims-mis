-- =============================================================================
-- Provenance system — Phase 1 foundations (docs/provenance-conflict-system-spec.md)
-- =============================================================================
-- 30 Apr 2026
--
-- Three tables:
--   claim_field_values       — every value ever seen for any field, versioned
--   field_source_authority   — config: which doc types win for which fields
--   field_change_policy      — config: what to do per (new vs current) scenario
--
-- Plus a v_current_claim_fields convenience view that picks the row with
-- is_current=true per (claim_id, field_name).
--
-- Spec adaptations to the live schema:
--   - claims.id is BIGSERIAL (not UUID) — claim_field_values.claim_id is BIGINT
--   - app_users have integer ids — captured_by / conflict_resolved_by stored
--     as TEXT (email) for portability with the existing audit-log conventions
--   - claim_audit_log doesn't exist yet (deferred); diffing piggy-backs on
--     activity_log when needed in Phase 2
--
-- Seed data covers spec §3 examples + the top fields the existing claims
-- table actually uses today (sum_insured, date_of_loss, loss_location,
-- gross_loss, policy_number, insured_name, policy_period_*, peril_type).
--
-- This migration is **PURELY ADDITIVE**. No existing columns are removed.
-- Phase B (dual-write) and Phase C (switch reads) ship in subsequent slices
-- per spec §10 — see CLAUDE.md for the rollout plan.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. claim_field_values (the heart of the system)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.claim_field_values (
    id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id                 BIGINT       NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
    field_name               TEXT         NOT NULL,

    -- The value itself: jsonb so we can carry typed values per spec §4
    -- (money/date/string/enum/pin/phone/email/gps/address). value_normalized
    -- is the equality-friendly canonical string (e.g. paise for money).
    value                    JSONB        NOT NULL,
    value_normalized         TEXT,

    -- Source
    source_type              TEXT         NOT NULL,
    source_id                UUID,
    source_document_type     TEXT,
    source_label             TEXT         NOT NULL,

    -- Extraction
    extracted_by             TEXT         NOT NULL,
    extraction_confidence    NUMERIC(3, 2),

    -- Status (only one current value per (claim, field))
    is_current               BOOLEAN      NOT NULL DEFAULT false,
    superseded_by            UUID         REFERENCES public.claim_field_values(id),
    superseded_at            TIMESTAMPTZ,
    superseded_reason        TEXT,

    -- Conflict tracking
    conflict_status          TEXT,
    conflict_raised_at       TIMESTAMPTZ,
    conflict_resolved_by     TEXT,
    conflict_resolved_at     TIMESTAMPTZ,
    conflict_reason          TEXT,
    resolution_note          TEXT,

    captured_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    captured_by              TEXT
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_field_values_source_type_check') THEN
        ALTER TABLE public.claim_field_values
            ADD CONSTRAINT claim_field_values_source_type_check
            CHECK (source_type IN ('email', 'document', 'manual', 'computed', 'external_api', 'migrated'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_field_values_conflict_status_check') THEN
        ALTER TABLE public.claim_field_values
            ADD CONSTRAINT claim_field_values_conflict_status_check
            CHECK (conflict_status IS NULL OR conflict_status IN (
                'pending', 'resolved_accepted', 'resolved_rejected', 'ignored'
            ));
    END IF;
END $$;

-- Only one current value per (claim, field).
CREATE UNIQUE INDEX IF NOT EXISTS uq_claim_field_values_current
    ON public.claim_field_values (claim_id, field_name)
    WHERE is_current = true;

CREATE INDEX IF NOT EXISTS idx_claim_field_values_claim_field
    ON public.claim_field_values (claim_id, field_name);
CREATE INDEX IF NOT EXISTS idx_claim_field_values_pending_conflicts
    ON public.claim_field_values (conflict_status)
    WHERE conflict_status = 'pending';

ALTER TABLE public.claim_field_values ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'claim_field_values'
          AND policyname = 'Allow all access to claim_field_values'
    ) THEN
        CREATE POLICY "Allow all access to claim_field_values" ON public.claim_field_values
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.claim_field_values
    IS 'Spec §3: append-only ledger of every value ever seen for every field on every claim. is_current=true picks the authoritative row. Phase A = backfill from existing columns; Phase B = dual-write; Phase C = switch reads via v_current_claim_fields; Phase D = drop redundant columns.';

-- -----------------------------------------------------------------------------
-- 2. field_source_authority (config table — admin-editable)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.field_source_authority (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    field_name            TEXT         NOT NULL,
    source_document_type  TEXT         NOT NULL,
    authority_rank        INTEGER      NOT NULL,        -- lower = higher authority
    notes                 TEXT,
    effective_from        DATE         NOT NULL DEFAULT CURRENT_DATE,
    effective_to          DATE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_source_authority_unique') THEN
        ALTER TABLE public.field_source_authority
            ADD CONSTRAINT field_source_authority_unique
            UNIQUE (field_name, source_document_type, effective_from);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_field_source_authority_field
    ON public.field_source_authority (field_name, authority_rank)
    WHERE effective_to IS NULL;

ALTER TABLE public.field_source_authority ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'field_source_authority'
          AND policyname = 'Allow all access to field_source_authority'
    ) THEN
        CREATE POLICY "Allow all access to field_source_authority" ON public.field_source_authority
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.field_source_authority
    IS 'Spec §3: per-field hierarchy of source document types. Lower rank = higher authority. Editable by admins without deployment.';

-- Seed: top fields the existing claims table actually uses today.
-- Endorsement > policy_schedule > policy_certificate > intimation_letter > email_body
-- for monetary fields (sum_insured, gross_loss, claim_amount_intimated).
INSERT INTO public.field_source_authority (field_name, source_document_type, authority_rank, notes) VALUES
    ('sum_insured', 'endorsement',          1, 'Mid-term changes override base policy'),
    ('sum_insured', 'policy_schedule',      2, 'Authoritative for base policy'),
    ('sum_insured', 'policy_certificate',   3, 'Summary doc, may lag'),
    ('sum_insured', 'intimation_letter',    4, 'Insurer summary at intimation'),
    ('sum_insured', 'email_body',           5, 'Lowest — narrative, prone to error'),
    ('sum_insured', 'manual_entry',         2, 'Surveyor manual entry; treated as policy-schedule equivalent'),

    ('gross_loss', 'fsr_draft',             1, 'Surveyor own assessment is most authoritative'),
    ('gross_loss', 'estimate_quotation',    2, 'Vendor / OEM estimate'),
    ('gross_loss', 'insured_statement',     3, 'Insured-stated quantum'),
    ('gross_loss', 'intimation_letter',     4, 'Insurer-stated quantum'),
    ('gross_loss', 'email_body',            5, 'Narrative'),

    ('claim_amount_intimated', 'intimation_letter', 1, 'Authoritative — that is what intimation captures'),
    ('claim_amount_intimated', 'email_body',         2, 'Narrative-only fallback'),

    ('date_loss', 'fir',                    1, 'Police-recorded date is strongest'),
    ('date_loss', 'insured_statement',      2, 'Formal signed statement'),
    ('date_loss', 'intimation_letter',      3, 'Insurer-relayed'),
    ('date_loss', 'email_body',             4, 'Narrative'),
    ('date_loss', 'manual_entry',           2, 'Surveyor verifies → equivalent to insured statement'),

    ('date_of_intimation', 'intimation_letter', 1, 'Date the intimation came in'),
    ('date_of_intimation', 'email_received_at', 1, 'Email metadata is equally authoritative'),

    ('policy_number', 'policy_schedule',    1, 'On the policy itself'),
    ('policy_number', 'endorsement',        1, 'Endorsement carries policy #'),
    ('policy_number', 'intimation_letter',  2, 'Insurer-relayed'),
    ('policy_number', 'email_body',         3, 'Narrative'),

    ('insured_name', 'policy_schedule',     1, 'On the policy itself'),
    ('insured_name', 'gstin_certificate',   1, 'For business insureds'),
    ('insured_name', 'intimation_letter',   2, 'Insurer-relayed'),
    ('insured_name', 'email_body',          3, 'Narrative'),

    ('insurer_name', 'intimation_letter',   1, 'Insurer themselves identify'),
    ('insurer_name', 'email_from_domain',   1, 'Equally authoritative'),
    ('insurer_name', 'email_body',          2, 'Narrative'),

    ('policy_period_from', 'policy_schedule', 1, 'On the policy itself'),
    ('policy_period_from', 'endorsement',     1, 'Endorsements may shift dates'),
    ('policy_period_from', 'intimation_letter', 2, 'Insurer-relayed'),

    ('policy_period_to', 'policy_schedule',   1, 'On the policy itself'),
    ('policy_period_to', 'endorsement',       1, 'Endorsements may shift dates'),
    ('policy_period_to', 'intimation_letter', 2, 'Insurer-relayed'),

    ('peril_type', 'fir',                    1, 'Police-classified peril'),
    ('peril_type', 'insured_statement',      2, 'Insured-claimed cause'),
    ('peril_type', 'intimation_letter',      3, 'Insurer-relayed'),
    ('peril_type', 'email_body',             4, 'Narrative'),

    ('loss_location', 'site_inspection_gps', 1, 'GPS coords from surveyor'),
    ('loss_location', 'fir',                 2, 'Address per police record'),
    ('loss_location', 'insured_statement',   3, 'As stated by insured'),
    ('loss_location', 'intimation_letter',   4, 'As relayed by insurer'),
    ('loss_location', 'email_body',          5, 'Narrative')
ON CONFLICT (field_name, source_document_type, effective_from) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. field_change_policy (config — when auto-update vs raise conflict)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.field_change_policy (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    field_name    TEXT         NOT NULL,
    scenario      TEXT         NOT NULL,
    action        TEXT         NOT NULL,
    notes         TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_change_policy_unique') THEN
        ALTER TABLE public.field_change_policy
            ADD CONSTRAINT field_change_policy_unique UNIQUE (field_name, scenario);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_change_policy_scenario_check') THEN
        ALTER TABLE public.field_change_policy
            ADD CONSTRAINT field_change_policy_scenario_check
            CHECK (scenario IN ('empty_to_value', 'equal_value', 'higher_authority', 'lower_authority', 'equal_authority_conflict'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_change_policy_action_check') THEN
        ALTER TABLE public.field_change_policy
            ADD CONSTRAINT field_change_policy_action_check
            CHECK (action IN ('auto_update', 'corroborate', 'raise_conflict', 'ignore_with_log'));
    END IF;
END $$;

ALTER TABLE public.field_change_policy ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'field_change_policy'
          AND policyname = 'Allow all access to field_change_policy'
    ) THEN
        CREATE POLICY "Allow all access to field_change_policy" ON public.field_change_policy
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.field_change_policy
    IS 'Spec §3: per-(field, scenario) policy. Wildcard field_name=__default__ provides fallback for fields that have no specific policy row. Code uses the default if a row is missing.';

-- Default policy applied to all fields unless overridden.
INSERT INTO public.field_change_policy (field_name, scenario, action, notes) VALUES
    ('__default__', 'empty_to_value',           'auto_update',    'No conflict possible — fill empty field'),
    ('__default__', 'equal_value',              'corroborate',    'Record evidence; do not change current'),
    ('__default__', 'higher_authority',         'raise_conflict', 'Suggest update; surveyor approves'),
    ('__default__', 'lower_authority',          'ignore_with_log','Record but do not change'),
    ('__default__', 'equal_authority_conflict', 'raise_conflict', 'Two equal sources disagree — human decides')
ON CONFLICT (field_name, scenario) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. v_current_claim_fields — the read-side view
-- -----------------------------------------------------------------------------
-- Phase 2 of the rollout switches read paths to this view. Phase 1 just
-- ships it so it's available for ad-hoc queries and the new APIs.

CREATE OR REPLACE VIEW public.v_current_claim_fields AS
SELECT
    cfv.claim_id,
    cfv.field_name,
    cfv.value,
    cfv.value_normalized,
    cfv.source_type,
    cfv.source_document_type,
    cfv.source_label,
    cfv.extracted_by,
    cfv.extraction_confidence,
    cfv.captured_at,
    cfv.captured_by,
    EXISTS (
        SELECT 1 FROM public.claim_field_values cfv2
        WHERE cfv2.claim_id = cfv.claim_id
          AND cfv2.field_name = cfv.field_name
          AND cfv2.conflict_status = 'pending'
    ) AS has_pending_conflict
FROM public.claim_field_values cfv
WHERE cfv.is_current = true;

COMMENT ON VIEW public.v_current_claim_fields
    IS 'Spec §10 Phase C target: every claim read goes through this view instead of raw claims columns. Currently advisory until Phase B (dual-write) lands.';

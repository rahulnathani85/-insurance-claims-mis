-- =============================================================================
-- ILA module — Phase 1 (docs/ila-module-spec.md §13 Phase 1)
-- =============================================================================
-- 30 Apr 2026
--
-- Three tables:
--   ila_drafts       — versioned working drafts of an Initial Loss Advice
--   ila_submissions  — final, signed PDF submission to the insurer
--   ila_co_signers   — multi-surveyor signoff for team assignments (table
--                      ships now; co-signer enforcement is Phase 2)
--
-- Adapted from the spec (which assumed UUID PKs throughout) to match the
-- live schema: claims.id is BIGSERIAL, app_users have integer ids, surveyors
-- have UUID ids. Foreign keys follow the live conventions.
--
-- The 'admissibility' values follow the spec enum verbatim. CHECK constraints
-- (not Postgres enums) so the value set can evolve without ALTER TYPE.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ila_drafts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ila_drafts (
    id                       BIGSERIAL    PRIMARY KEY,
    claim_id                 BIGINT       NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
    version                  INTEGER      NOT NULL DEFAULT 1,

    -- Editorial sections (spec §4)
    cover_data               JSONB        NOT NULL DEFAULT '{}'::jsonb,
    preliminary_view         TEXT,
    admissibility_opinion    TEXT,
    admissibility_reasoning  TEXT,
    preliminary_estimate     NUMERIC(15, 2),
    estimate_basis           TEXT,
    documents_required       JSONB        NOT NULL DEFAULT '[]'::jsonb,
    next_steps               TEXT,
    expected_fsr_date        DATE,
    observations             TEXT,

    -- Drafting bookkeeping
    drafted_by               TEXT,
    ai_confidence            NUMERIC(3, 2),

    -- Workflow status
    status                   TEXT         NOT NULL DEFAULT 'draft',

    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by               TEXT,
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by               TEXT
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ila_drafts_claim_version_unique') THEN
        ALTER TABLE public.ila_drafts
            ADD CONSTRAINT ila_drafts_claim_version_unique UNIQUE (claim_id, version);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ila_drafts_status_check') THEN
        ALTER TABLE public.ila_drafts
            ADD CONSTRAINT ila_drafts_status_check
            CHECK (status IN ('draft', 'under_review', 'approved', 'rejected', 'superseded'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ila_drafts_admissibility_check') THEN
        ALTER TABLE public.ila_drafts
            ADD CONSTRAINT ila_drafts_admissibility_check
            CHECK (admissibility_opinion IS NULL OR admissibility_opinion IN (
                'admissible', 'admissible_with_conditions', 'needs_investigation',
                'likely_non_admissible', 'non_admissible'
            ));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ila_drafts_claim_id    ON public.ila_drafts (claim_id);
CREATE INDEX IF NOT EXISTS idx_ila_drafts_status      ON public.ila_drafts (status);

ALTER TABLE public.ila_drafts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'ila_drafts'
          AND policyname = 'Allow all access to ila_drafts'
    ) THEN
        CREATE POLICY "Allow all access to ila_drafts" ON public.ila_drafts
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.ila_drafts
    IS 'Spec §4: versioned ILA drafts. Auto-saved during editing; one row per (claim, version). Final approved draft is referenced by ila_submissions.';

-- -----------------------------------------------------------------------------
-- 2. ila_submissions
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ila_submissions (
    id                        BIGSERIAL    PRIMARY KEY,
    claim_id                  BIGINT       NOT NULL REFERENCES public.claims(id),
    draft_id                  BIGINT       NOT NULL REFERENCES public.ila_drafts(id),

    -- Signoff (immutable once written — captured at submission time)
    signed_by_email           TEXT         NOT NULL,
    signed_by_name            TEXT,
    signer_irdai_license_no   TEXT         NOT NULL,
    signer_category           TEXT,

    -- Output
    pdf_storage_path          TEXT,
    pdf_hash                  TEXT,
    pdf_size_bytes            INTEGER,

    -- Submission to insurer
    submitted_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    submitted_via             TEXT         NOT NULL DEFAULT 'email',
    submitted_to_email        TEXT,
    submission_notification_id BIGINT      REFERENCES public.notification_queue(id),

    -- TAT compliance (spec §10)
    tat_compliant             BOOLEAN      NOT NULL,
    tat_breach_reason         TEXT,

    -- Acknowledgement from insurer (Phase 2 — captured manually for now)
    insurer_acknowledged_at   TIMESTAMPTZ,
    insurer_ack_reference     TEXT,

    company                   TEXT         NOT NULL DEFAULT 'NISLA',
    created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ila_submissions_via_check') THEN
        ALTER TABLE public.ila_submissions
            ADD CONSTRAINT ila_submissions_via_check
            CHECK (submitted_via IN ('email', 'insurer_portal', 'manual'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ila_submissions_claim_id ON public.ila_submissions (claim_id);
CREATE INDEX IF NOT EXISTS idx_ila_submissions_submitted_at ON public.ila_submissions (submitted_at DESC);

ALTER TABLE public.ila_submissions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'ila_submissions'
          AND policyname = 'Allow all access to ila_submissions'
    ) THEN
        CREATE POLICY "Allow all access to ila_submissions" ON public.ila_submissions
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.ila_submissions
    IS 'Spec §4: final ILA submission. One row per submitted ILA. Signoff fields immutable once written. tat_compliant computed at insert: submitted_at <= claim.ila_due_at.';

-- -----------------------------------------------------------------------------
-- 3. ila_co_signers (Phase 2 enforcement; table ships now)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ila_co_signers (
    id              BIGSERIAL    PRIMARY KEY,
    submission_id   BIGINT       NOT NULL REFERENCES public.ila_submissions(id) ON DELETE CASCADE,
    surveyor_id     UUID         REFERENCES public.surveyors(id),
    user_email      TEXT         NOT NULL,
    user_name       TEXT,
    role            TEXT         NOT NULL,
    irdai_license_no TEXT,
    signed_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ila_co_signers_role_check') THEN
        ALTER TABLE public.ila_co_signers
            ADD CONSTRAINT ila_co_signers_role_check
            CHECK (role IN ('lead_surveyor', 'co_surveyor', 'engineer', 'ca', 'manager', 'observer'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ila_co_signers_unique') THEN
        ALTER TABLE public.ila_co_signers
            ADD CONSTRAINT ila_co_signers_unique UNIQUE (submission_id, user_email);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ila_co_signers_submission ON public.ila_co_signers (submission_id);

ALTER TABLE public.ila_co_signers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'ila_co_signers'
          AND policyname = 'Allow all access to ila_co_signers'
    ) THEN
        CREATE POLICY "Allow all access to ila_co_signers" ON public.ila_co_signers
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.ila_co_signers
    IS 'Spec §8: co-signer signoffs for team-assigned ILAs. Table ships in Phase 1; enforcement (block submission until all approve) is Phase 2.';

-- =============================================================================
-- 20260502010000_claim_issues.sql
-- =============================================================================
-- Slice 10 — claim_issues: AI-flagged gaps and provenance conflicts.
--
-- Surfaces a per-claim "what's wrong / missing / conflicting" list that
-- surveyors can resolve. Three sources feed into it:
--
--   1. Provenance conflicts — when dual-write detects a higher-authority
--      value disagreeing with the current value, lib/provenance writes
--      a conflict_status='pending' row in claim_field_values. We mirror
--      those into claim_issues so they show up in the UI without the
--      panel having to know about provenance internals.
--
--   2. AI validation — when /api/ai/fsr-narrative or the eventual
--      enrichment route notices a gap (e.g. "policy period missing",
--      "loss date outside policy"), it writes a row here.
--
--   3. Manual surveyor flags — a surveyor can mark a follow-up as an
--      issue ("dealer hasn't sent the tax invoice") so it appears in
--      the panel and isn't lost.
--
-- Severity: info | warn | error (mirrors provenance scenario severities).
-- Status:   open | resolved | dismissed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.claim_issues (
    id              BIGSERIAL    PRIMARY KEY,
    claim_id        BIGINT       NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,

    severity        TEXT         NOT NULL DEFAULT 'warn',
    code            TEXT         NOT NULL,           -- machine-readable, e.g. 'POLICY_DATE_MISSING'
    field           TEXT,                            -- claim column / narrative key the issue applies to
    message         TEXT         NOT NULL,           -- one-line explanation for the surveyor
    detail          JSONB,                           -- optional structured payload

    source_type     TEXT         NOT NULL DEFAULT 'manual',   -- 'manual' | 'ai' | 'provenance'
    source_id       TEXT,                                     -- polymorphic FK reference

    status          TEXT         NOT NULL DEFAULT 'open',     -- 'open' | 'resolved' | 'dismissed'
    resolved_at     TIMESTAMPTZ,
    resolved_by     TEXT,                                     -- email
    resolution_note TEXT,

    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by      TEXT,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_issues_severity_check') THEN
        ALTER TABLE public.claim_issues
            ADD CONSTRAINT claim_issues_severity_check
            CHECK (severity IN ('info', 'warn', 'error'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_issues_status_check') THEN
        ALTER TABLE public.claim_issues
            ADD CONSTRAINT claim_issues_status_check
            CHECK (status IN ('open', 'resolved', 'dismissed'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_issues_source_check') THEN
        ALTER TABLE public.claim_issues
            ADD CONSTRAINT claim_issues_source_check
            CHECK (source_type IN ('manual', 'ai', 'provenance'));
    END IF;
END $$;

-- Most queries are "open issues for a claim" — index that hot path.
CREATE INDEX IF NOT EXISTS idx_claim_issues_open
    ON public.claim_issues (claim_id, status)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_claim_issues_claim
    ON public.claim_issues (claim_id);

ALTER TABLE public.claim_issues ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'claim_issues'
          AND policyname = 'Allow all access to claim_issues'
    ) THEN
        CREATE POLICY "Allow all access to claim_issues" ON public.claim_issues
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.claim_issues
    IS 'Slice 10: per-claim issues (gaps, conflicts, manual flags). Surfaces in the claim-detail Issues panel. Severity info/warn/error; status open/resolved/dismissed.';

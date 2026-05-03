-- =============================================================================
-- Registration drafts (Slice E from registration-module-spec.md §8)
-- =============================================================================
-- 30 Apr 2026
--
-- The new 3-column registration UI debounces a save every ~10s so a clerk
-- doesn't lose work if the tab closes. Drafts are scoped per claim — one
-- in-flight registration form per claim row.
--
-- Choice of shape: a single jsonb `draft_data` blob rather than one column
-- per spec field. The registration form is still evolving (Phase 2 will add
-- assignment + fee blocks); a JSON blob keeps the schema stable while the
-- form definition grows. Final REGISTERED claim data lives on `claims` —
-- this table is intentionally throwaway state.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.claim_drafts (
    claim_id      BIGINT       PRIMARY KEY REFERENCES public.claims(id) ON DELETE CASCADE,
    draft_data    JSONB        NOT NULL DEFAULT '{}'::jsonb,
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by    TEXT
);

CREATE INDEX IF NOT EXISTS idx_claim_drafts_updated_at
    ON public.claim_drafts (updated_at DESC);

ALTER TABLE public.claim_drafts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'claim_drafts'
          AND policyname = 'Allow all access to claim_drafts'
    ) THEN
        CREATE POLICY "Allow all access to claim_drafts" ON public.claim_drafts
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.claim_drafts
    IS 'Spec §8: per-claim in-flight registration form data. Auto-saved every ~10s by the registration UI. Discarded on successful registration (cascade or manual cleanup).';
COMMENT ON COLUMN public.claim_drafts.draft_data
    IS 'Free-form JSON. Shape is owned by lib/registrationDraft.js. Final values are copied to columns on /api/claims/[id] PUT during registration.';

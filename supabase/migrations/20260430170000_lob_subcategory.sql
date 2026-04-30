-- =============================================================================
-- Slice "modifications 30-04-2026" M1: lob_subcategory on claims
-- =============================================================================
-- 30 Apr 2026
--
-- Per docs/modifications 30-04-2026.md §3 / §5: at registration time the
-- surveyor picks an IRDAI sub-category of the chosen LOB (e.g. for Fire:
-- "SFSP", "Bharat Griha Raksha", "IAR"...). The portal auto-suggests from
-- the LLM extraction; clerk overrides if needed.
--
-- The list of valid sub-categories per LOB lives in lib/lobSubcategories.js
-- (data, not schema) so the IRDAI taxonomy can be tweaked without a
-- migration. This column just stores the chosen string.
-- =============================================================================

ALTER TABLE public.claims
    ADD COLUMN IF NOT EXISTS lob_subcategory TEXT;

CREATE INDEX IF NOT EXISTS idx_claims_lob_subcategory
    ON public.claims (lob, lob_subcategory)
    WHERE lob_subcategory IS NOT NULL;

COMMENT ON COLUMN public.claims.lob_subcategory
    IS 'IRDAI sub-category of LOB picked at registration. Free-text but expected to match an entry in lib/lobSubcategories.js LOB_SUBCATEGORIES[lob].';

-- =============================================================================
-- 20260504124513_insurer_agent_columns.sql
-- =============================================================================
-- Adds the 3 columns the Insurer Registration Agent (/insurer-master/register)
-- needs to surface but the original schema was missing:
--
--   gstin           - 15-char GSTIN (insurer's primary registration). The
--                     existing /insurer-master form already renders an input
--                     for this but had nowhere to persist it.
--   irdai_reg_no    - IRDAI registration number. Used by the agent's name
--                     lookup output and shown on the FSR cover page.
--   ownership_type  - 'PSU' | 'Private' | 'Standalone Health' | 'Foreign Reinsurer'.
--                     Free text (no enum) so future categories don't break
--                     migrations. Validated client-side only.
--
-- All three are nullable — backfill happens organically as new insurers are
-- registered via the agent. Existing rows keep their NULLs.
-- =============================================================================

BEGIN;

ALTER TABLE public.insurers ADD COLUMN IF NOT EXISTS gstin          TEXT;
ALTER TABLE public.insurers ADD COLUMN IF NOT EXISTS irdai_reg_no   TEXT;
ALTER TABLE public.insurers ADD COLUMN IF NOT EXISTS ownership_type TEXT;

COMMENT ON COLUMN public.insurers.gstin          IS '15-char GSTIN. Format-validated client-side; checksum verified by lib/insurerAgent/confidence.js.';
COMMENT ON COLUMN public.insurers.irdai_reg_no   IS 'IRDAI Certificate of Registration number. Used on FSR cover and surveyor master.';
COMMENT ON COLUMN public.insurers.ownership_type IS 'PSU / Private / Standalone Health / Foreign Reinsurer. Free text by design.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- =============================================================================
-- 20260501010000_fsr_drafts_template_and_narrative.sql
-- =============================================================================
-- Adds two columns to claim_fsr_drafts that the new template-based render
-- flow (lib/fsr/render.js + /api/fsr-drafts/render) needs:
--
--   template_name   TEXT       — which fsr_lob_templates row this draft was
--                                rendered from. Defaults to 'Default' so
--                                existing drafts keep parity with the older
--                                Fire/Marine templates.
--   narrative_jsonb JSONB      — saved per-section narrative blocks (about
--                                insured, situation of loss, observations,
--                                etc). Used so re-renders preserve the
--                                surveyor's prose without forcing the
--                                drafter to retype it.
--
-- Both columns are NULLable. Existing rows are left untouched.
-- =============================================================================

ALTER TABLE public.claim_fsr_drafts
    ADD COLUMN IF NOT EXISTS template_name TEXT;

ALTER TABLE public.claim_fsr_drafts
    ADD COLUMN IF NOT EXISTS narrative_jsonb JSONB;

COMMENT ON COLUMN public.claim_fsr_drafts.template_name
    IS 'fsr_lob_templates.template_name this draft was rendered against. NULL for legacy drafts predating the template-based render flow.';

COMMENT ON COLUMN public.claim_fsr_drafts.narrative_jsonb
    IS 'Per-section narrative blocks (situation_of_loss, observations, consent_of_insured, etc) saved by the surveyor. Used as the {{narrative.*}} placeholder source on re-render.';

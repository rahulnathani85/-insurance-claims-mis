-- =============================================================================
-- 20260503020000_marine_handling_label.sql
-- =============================================================================
-- Flag-4 fix-up: adds a `handling_label` column to marine_loss_sheets so
-- surveyors can label the handling-rate row of the cascade per claim.
--
-- The Marine Cargo computation cascade has a final percentage adder
-- between the GST sub-total and the gross loss. Production samples use
-- different labels for it depending on policy type / insurer:
--
--   T-012 (ACUERE, Marine Cargo Open Policy)         "Add 10%"
--   4790  (NISLA, Marine Cargo Annual Turn Over)     "Add +10%"
--   Other Marine Sales Turnover policies              "Sundry @ 10%"
--   Some inland-only policies                          "Handling"
--
-- Until now the renderer hardcoded `'Handling'` and only the surveyor's
-- choice of percentage flowed through. With this column the surveyor
-- can override the label on a per-claim basis, matching the production
-- samples exactly.
--
-- Default 'Add 10%' matches the most common case in the four production
-- Marine Cargo samples we have on file. Existing rows pick up the
-- default automatically; surveyors can edit it via the marine
-- loss-sheet form (when that UI ships — currently surveyors edit
-- directly via Supabase or the API).
-- =============================================================================

ALTER TABLE public.marine_loss_sheets
    ADD COLUMN IF NOT EXISTS handling_label TEXT NOT NULL DEFAULT 'Add 10%';

COMMENT ON COLUMN public.marine_loss_sheets.handling_label
    IS 'Flag-4 fix-up: surveyor-editable label for the handling-rate row in the Marine Cargo loss cascade. Production samples use "Add 10%" / "Add +10%" / "Sundry @ 10%" / "Handling" depending on policy type. Renderer reads this via lib/fsr/render.js buildMarineLossContext().';

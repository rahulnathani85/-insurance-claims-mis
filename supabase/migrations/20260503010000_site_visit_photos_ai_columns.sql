-- =============================================================================
-- 20260503010000_site_visit_photos_ai_columns.sql
-- =============================================================================
-- Slice 8 / 9 — adds AI-classification columns to site_visit_photos.
--
-- The site_visits + site_visit_photos schema from 20260430130000 already
-- captures uploads, EXIF (gps_lat / gps_lng / taken_at / has_geotag /
-- has_timestamp), and lifecycle. This migration layers the AI vision
-- classifier output on top:
--
--   classification_status   'unclassified' | 'classified' | 'classification_failed'
--   category                e.g. 'DAMAGED_CARGO' | 'SERIAL_PLATE' | 'DOCUMENTS'
--   tags                    short keywords ['water_damage', 'east_wall', ...]
--   ai_observations         one factual sentence describing the photo
--   suggested_annexure      'Photographs - Damaged Cargo'
--   ai_confidence           0..1
--   flags                   ['tampering_visible', 'pre_existing_damage', ...]
--   classified_at           timestamp
--   classified_by           'ai:claude:sonnet-4' | 'ai:gemini:flash-2.0' | 'human:<email>'
--
-- All columns are NULLable; existing photo rows stay valid. Slice 9's
-- /api/ai/classify-photos endpoint fills these in via Claude / Gemini
-- vision API. The chat copilot's photo loader (Slice 7) already
-- queries against `category` + `observations` + `flags` + a
-- `status='classified'` filter — once those columns exist, the loader
-- will pick up classifications automatically.
--
-- Note: the existing schema has columns named `taken_at`, `gps_lat`,
-- `gps_lng`, `original_exif`, `file_name`, `file_url`, `caption`. The
-- chat photo loader (in /api/ai/claim-chat/route.js) selects
-- `filename, category, observations, flags, confidence` — but those
-- aliases (filename, observations, confidence) don't match the actual
-- column names. We use `ai_observations` + `ai_confidence` to avoid
-- shadowing existing columns. The chat loader will need a small alias
-- pass — handled in code, not in this migration.
-- =============================================================================

ALTER TABLE public.site_visit_photos
    ADD COLUMN IF NOT EXISTS classification_status TEXT NOT NULL DEFAULT 'unclassified';

ALTER TABLE public.site_visit_photos
    ADD COLUMN IF NOT EXISTS category           TEXT;

ALTER TABLE public.site_visit_photos
    ADD COLUMN IF NOT EXISTS tags               JSONB;

ALTER TABLE public.site_visit_photos
    ADD COLUMN IF NOT EXISTS ai_observations    TEXT;

ALTER TABLE public.site_visit_photos
    ADD COLUMN IF NOT EXISTS suggested_annexure TEXT;

ALTER TABLE public.site_visit_photos
    ADD COLUMN IF NOT EXISTS ai_confidence      NUMERIC(3, 2);

ALTER TABLE public.site_visit_photos
    ADD COLUMN IF NOT EXISTS flags              JSONB;

ALTER TABLE public.site_visit_photos
    ADD COLUMN IF NOT EXISTS classified_at      TIMESTAMPTZ;

ALTER TABLE public.site_visit_photos
    ADD COLUMN IF NOT EXISTS classified_by      TEXT;

ALTER TABLE public.site_visit_photos
    ADD COLUMN IF NOT EXISTS is_annexure        BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_visit_photos_classification_status_check') THEN
        ALTER TABLE public.site_visit_photos
            ADD CONSTRAINT site_visit_photos_classification_status_check
            CHECK (classification_status IN ('unclassified', 'classified', 'classification_failed'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_visit_photos_ai_confidence_check') THEN
        ALTER TABLE public.site_visit_photos
            ADD CONSTRAINT site_visit_photos_ai_confidence_check
            CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1));
    END IF;
END $$;

-- "What still needs classifying?" hot path
CREATE INDEX IF NOT EXISTS idx_site_visit_photos_unclassified
    ON public.site_visit_photos (claim_id)
    WHERE classification_status = 'unclassified';

-- "Show classified photos for a claim grouped by category" hot path
CREATE INDEX IF NOT EXISTS idx_site_visit_photos_category
    ON public.site_visit_photos (claim_id, category)
    WHERE classification_status = 'classified';

COMMENT ON COLUMN public.site_visit_photos.classification_status
    IS 'Slice 9 lifecycle. Defaults unclassified; flips to classified after Claude/Gemini vision tags it. Failures get classification_failed so the panel can show a retry chip.';
COMMENT ON COLUMN public.site_visit_photos.category
    IS 'AI-assigned high-level bucket. LOB-specific lists in lib/fsr/photoClassifyPrompt.js (Marine: DAMAGED_CARGO/CONTAINER_*; EW: DAMAGED_UNIT/SERIAL_PLATE/...; Fire: FIRE_DAMAGE/STRUCTURE_*).';
COMMENT ON COLUMN public.site_visit_photos.flags
    IS 'AI red-flag list — tampering_visible, pre_existing_damage, unclear_evidence, date_mismatch, etc. Surfaced in the UI as red badges so surveyors can act on them.';
COMMENT ON COLUMN public.site_visit_photos.is_annexure
    IS 'Include in the FSR annexure auto-build? Defaults true; surveyor can untoggle for off-topic / personal photos.';

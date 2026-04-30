-- =============================================================================
-- Site visits + photo evidence (CLAUDE.md §13: IRDAI mandatory)
-- =============================================================================
-- 30 Apr 2026
--
-- IRDAI requires geotagged + timestamped photo evidence for every site visit.
-- Until now the portal had no site-visit module — surveyors recorded visits in
-- email and notes only. This migration introduces:
--
--   1. site_visits — one row per physical/virtual visit to a loss site.
--      Linked to claims via claim_id (BIGINT, matches claims.id BIGSERIAL).
--      Tracks scheduled / actual times, attendees, surveyor, observations.
--   2. site_visit_photos — one row per photo, with EXIF-derived GPS lat/lng
--      and capture timestamp persisted as columns AND the raw EXIF retained
--      as JSONB for audit. has_geotag / has_timestamp flags let the UI
--      flag photos that don't meet the IRDAI evidentiary bar.
--   3. RLS enabled with permissive policy — matches the surrounding tables;
--      tightening to per-role RLS is a separate cross-cutting cleanup
--      (CLAUDE.md §9).
--
-- Out of scope here:
--   - claim_documents (separate generic doc table — empty in NEW per migration
--     notes). Site-visit photos are scoped to this dedicated table.
--   - PDF generation of a site-visit report (Phase 2 once Fire FSR is wired).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. site_visits
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.site_visits (
    id                   BIGSERIAL  PRIMARY KEY,
    claim_id             BIGINT     NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
    visit_number         INTEGER    NOT NULL DEFAULT 1,
    purpose              TEXT,
    status               TEXT       NOT NULL DEFAULT 'planned',
    surveyor_id          UUID       REFERENCES public.surveyors(id),
    conducted_by_email   TEXT,
    conducted_by_name    TEXT,

    scheduled_at         TIMESTAMPTZ,
    started_at           TIMESTAMPTZ,
    completed_at         TIMESTAMPTZ,

    location_address     TEXT,
    location_pin         TEXT,
    location_state       TEXT,
    location_district    TEXT,
    location_lat         NUMERIC(9,6),
    location_lng         NUMERIC(9,6),

    attendees            TEXT[],
    weather_conditions   TEXT,
    observations         TEXT,
    next_steps           TEXT,

    company              TEXT       NOT NULL DEFAULT 'NISLA',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by           TEXT,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by           TEXT
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'site_visits_status_check'
    ) THEN
        ALTER TABLE public.site_visits
            ADD CONSTRAINT site_visits_status_check
            CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'site_visits_claim_visit_unique'
    ) THEN
        ALTER TABLE public.site_visits
            ADD CONSTRAINT site_visits_claim_visit_unique
            UNIQUE (claim_id, visit_number);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_site_visits_claim_id   ON public.site_visits (claim_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_surveyor   ON public.site_visits (surveyor_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_status     ON public.site_visits (status);
CREATE INDEX IF NOT EXISTS idx_site_visits_scheduled  ON public.site_visits (scheduled_at)
    WHERE scheduled_at IS NOT NULL;

ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'site_visits'
          AND policyname = 'Allow all access to site_visits'
    ) THEN
        CREATE POLICY "Allow all access to site_visits" ON public.site_visits
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.site_visits
    IS 'Physical / virtual visit to the loss site. IRDAI requires geotagged + timestamped photo evidence per visit (CLAUDE.md §13).';

-- -----------------------------------------------------------------------------
-- 2. site_visit_photos
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.site_visit_photos (
    id                BIGSERIAL  PRIMARY KEY,
    site_visit_id     BIGINT     NOT NULL REFERENCES public.site_visits(id) ON DELETE CASCADE,
    claim_id          BIGINT     NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,

    file_name         TEXT       NOT NULL,
    file_url          TEXT       NOT NULL,
    file_size         BIGINT,
    mime_type         TEXT,
    caption           TEXT,

    taken_at          TIMESTAMPTZ,
    gps_lat           NUMERIC(9,6),
    gps_lng           NUMERIC(9,6),
    camera_make       TEXT,
    camera_model      TEXT,
    original_exif     JSONB,

    has_geotag        BOOLEAN    NOT NULL DEFAULT false,
    has_timestamp     BOOLEAN    NOT NULL DEFAULT false,

    uploaded_by_email TEXT,
    uploaded_by_name  TEXT,
    uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_visit_photos_visit_id ON public.site_visit_photos (site_visit_id);
CREATE INDEX IF NOT EXISTS idx_site_visit_photos_claim_id ON public.site_visit_photos (claim_id);
CREATE INDEX IF NOT EXISTS idx_site_visit_photos_taken_at ON public.site_visit_photos (taken_at)
    WHERE taken_at IS NOT NULL;

ALTER TABLE public.site_visit_photos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'site_visit_photos'
          AND policyname = 'Allow all access to site_visit_photos'
    ) THEN
        CREATE POLICY "Allow all access to site_visit_photos" ON public.site_visit_photos
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON COLUMN public.site_visit_photos.has_geotag
    IS 'true iff EXIF GPSLatitude + GPSLongitude were both extractable. UI flags photos without geotag as non-evidentiary.';
COMMENT ON COLUMN public.site_visit_photos.has_timestamp
    IS 'true iff EXIF DateTimeOriginal was extractable. UI flags photos without timestamp as non-evidentiary.';
COMMENT ON COLUMN public.site_visit_photos.original_exif
    IS 'Full EXIF blob (jsonb) retained for audit. Individual columns above are denormalised projections for query performance.';

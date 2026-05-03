-- =============================================================================
-- Backfill migration: surveyors table
-- =============================================================================
-- Discovered while migrating data from OLD prod into the new Supabase project
-- on 29 Apr 2026: OLD prod had a `surveyors` table (UUID PK, with RLS) that was
-- created manually outside of any migration file. This migration codifies it so
-- fresh deployments include it.
--
-- Schema verbatim from OLD via:
--   pg_dump --schema-only --table=public.surveyors --no-owner --no-privileges
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.surveyors (
    id          uuid                       DEFAULT gen_random_uuid() NOT NULL,
    name        text                                                 NOT NULL,
    designation text,
    phone       text,
    email       text,
    company     text                       DEFAULT 'All'::text,
    active      boolean                    DEFAULT true,
    created_at  timestamp with time zone   DEFAULT now()
);

-- PK constraint (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'surveyors_pkey'
    ) THEN
        ALTER TABLE public.surveyors ADD CONSTRAINT surveyors_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- RLS + permissive policy (matches OLD prod behaviour)
ALTER TABLE public.surveyors ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'surveyors'
          AND policyname = 'Allow all access to surveyors'
    ) THEN
        CREATE POLICY "Allow all access to surveyors" ON public.surveyors
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

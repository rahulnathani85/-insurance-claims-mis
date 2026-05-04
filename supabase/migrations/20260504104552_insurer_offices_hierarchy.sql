-- =============================================================================
-- 20260504104552_insurer_offices_hierarchy.sql
-- =============================================================================
-- Adds the 7-level office hierarchy on top of the existing free-text `type`
-- column on public.insurer_offices.
--
-- 7 office codes:
--   HO    Head Office
--   RO    Regional Office
--   LCBO  Large / Corporate Branch Office
--   ZO    Zonal Office
--   RCH   Regional Claims Hub
--   CCH   Corporate Claims Hub
--   BO    Branch Office
--
-- Hierarchy rules (encoded in lib/insurerOfficeTypes.js + enforced server-side
-- by app/api/insurer-offices/[id]/route.js):
--   HO   - root, no parent
--   RO   - parent = HO
--   LCBO - parent = HO
--   ZO   - parent = HO
--   RCH  - parent = RO or ZO
--   CCH  - parent = RCH
--   BO   - parent = RO or ZO or RCH or CCH or LCBO
--
-- The legacy `type` column is preserved and kept in sync from `office_code`
-- by a trigger so existing readers (e.g. /api/offices) keep working until
-- they're migrated to the new view.
--
-- Backfill rule for existing free-text `type`:
--   'Head Office'                                          → HO
--   'Regional Office' / 'RO'                               → RO
--   'LCBO'                                                 → LCBO
--   'Zonal Office' / 'ZO'                                  → ZO
--   'Regional Claims Hub' / 'RCH' / 'Claims Hub'           → RCH
--   'Corporate Claims Hub' / 'CCH'                         → CCH
--   'Branch Office' / 'BO' / anything unrecognised         → BO
-- =============================================================================

BEGIN;

-- pg_trgm powers the type-ahead ILIKE search on name + city.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ----- 1. New columns -----
ALTER TABLE public.insurer_offices
  ADD COLUMN IF NOT EXISTS office_code        TEXT,
  ADD COLUMN IF NOT EXISTS parent_office_id   BIGINT,
  ADD COLUMN IF NOT EXISTS is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS display_order      INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS office_short_code  TEXT;

-- Self-FK (added separately so IF NOT EXISTS works cleanly even on re-run).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'insurer_offices_parent_office_id_fkey'
  ) THEN
    ALTER TABLE public.insurer_offices
      ADD CONSTRAINT insurer_offices_parent_office_id_fkey
      FOREIGN KEY (parent_office_id)
      REFERENCES public.insurer_offices(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ----- 2. Backfill office_code from existing free-text type -----
-- Done in one UPDATE pass with a CASE. Anything we don't recognise lands on
-- 'BO' so the NOT NULL constraint we add next can apply universally.
UPDATE public.insurer_offices
SET office_code = CASE
    WHEN UPPER(COALESCE(type, '')) IN ('HO', 'HEAD OFFICE')                              THEN 'HO'
    WHEN UPPER(COALESCE(type, '')) IN ('RO', 'REGIONAL OFFICE')                          THEN 'RO'
    WHEN UPPER(COALESCE(type, '')) IN ('LCBO', 'LARGE CORPORATE BRANCH OFFICE',
                                       'LARGE/CORPORATE BRANCH OFFICE',
                                       'LARGE CORPORATE BRANCH')                         THEN 'LCBO'
    WHEN UPPER(COALESCE(type, '')) IN ('ZO', 'ZONAL OFFICE')                             THEN 'ZO'
    WHEN UPPER(COALESCE(type, '')) IN ('RCH', 'REGIONAL CLAIMS HUB', 'CLAIMS HUB')       THEN 'RCH'
    WHEN UPPER(COALESCE(type, '')) IN ('CCH', 'CORPORATE CLAIMS HUB')                    THEN 'CCH'
    WHEN UPPER(COALESCE(type, '')) IN ('BO', 'BRANCH OFFICE', 'BRANCH')                  THEN 'BO'
    ELSE 'BO'
  END
WHERE office_code IS NULL;

-- ----- 3. CHECK constraint + NOT NULL on office_code -----
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'insurer_offices_office_code_check'
  ) THEN
    ALTER TABLE public.insurer_offices
      ADD CONSTRAINT insurer_offices_office_code_check
      CHECK (office_code IN ('HO', 'RO', 'LCBO', 'ZO', 'RCH', 'CCH', 'BO'));
  END IF;
END $$;

ALTER TABLE public.insurer_offices
  ALTER COLUMN office_code SET NOT NULL;

-- ----- 4. Trigger: keep legacy `type` synced from office_code -----
-- Legacy readers (e.g. /api/offices, /claims forms) still SELECT `type`.
-- Until those are migrated to read office_code, we mirror office_code →
-- type on every INSERT/UPDATE so the column doesn't drift. Once all
-- readers are off `type`, we'll drop both the trigger and the column.
CREATE OR REPLACE FUNCTION public.fn_insurer_offices_sync_legacy_type()
RETURNS TRIGGER AS $$
BEGIN
  -- Mirror office_code into the human-readable legacy values that existing
  -- frontend code recognises (matches the hardcoded OFFICE_TYPES in the
  -- old insurer-master UI).
  NEW.type := CASE NEW.office_code
    WHEN 'HO'   THEN 'Head Office'
    WHEN 'RO'   THEN 'Regional Office'
    WHEN 'LCBO' THEN 'LCBO'
    WHEN 'ZO'   THEN 'Zonal Office'
    WHEN 'RCH'  THEN 'Regional Claims Hub'
    WHEN 'CCH'  THEN 'Corporate Claims Hub'
    WHEN 'BO'   THEN 'Branch Office'
    ELSE NEW.type
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_insurer_offices_sync_legacy_type ON public.insurer_offices;
CREATE TRIGGER trg_insurer_offices_sync_legacy_type
  BEFORE INSERT OR UPDATE OF office_code ON public.insurer_offices
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_insurer_offices_sync_legacy_type();

-- ----- 5. Indexes -----
-- Singleton HO per insurer (partial UNIQUE index).
CREATE UNIQUE INDEX IF NOT EXISTS uq_insurer_offices_one_ho_per_insurer
  ON public.insurer_offices (insurer_id)
  WHERE office_code = 'HO';

-- Hierarchy + filtering indexes.
CREATE INDEX IF NOT EXISTS idx_insurer_offices_parent_office_id
  ON public.insurer_offices (parent_office_id)
  WHERE parent_office_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_insurer_offices_insurer_office_code
  ON public.insurer_offices (insurer_id, office_code);

CREATE INDEX IF NOT EXISTS idx_insurer_offices_insurer_active
  ON public.insurer_offices (insurer_id, is_active);

-- pg_trgm GIN indexes for type-ahead ILIKE search (used by /api/offices/search).
CREATE INDEX IF NOT EXISTS idx_insurer_offices_name_trgm
  ON public.insurer_offices USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_insurer_offices_city_trgm
  ON public.insurer_offices USING GIN (city gin_trgm_ops);

-- ----- 6. Recursive view: each office + its full hierarchy_path -----
-- hierarchy_path is the slash-joined chain of names from root to leaf,
-- e.g. "Mumbai RO / Andheri Branch". depth is 1 for HO and increments
-- per level. Used by the office picker UI and the /api/offices/search
-- endpoint to render breadcrumbs.
DROP VIEW IF EXISTS public.v_insurer_offices_with_path;

CREATE VIEW public.v_insurer_offices_with_path AS
WITH RECURSIVE office_tree AS (
    -- Roots: any office with no parent (typically HOs, but any orphan also
    -- surfaces here so the UI can render it instead of silently hiding it).
    SELECT
        o.id,
        o.insurer_id,
        o.parent_office_id,
        o.office_code,
        o.name,
        o.address,
        o.city,
        o.state,
        o.pin,
        o.gstin,
        o.phone,
        o.email,
        o.contact_person,
        o.is_active,
        o.display_order,
        o.office_short_code,
        o.type,
        o.created_at,
        o.name::TEXT     AS hierarchy_path,
        1                AS depth
    FROM public.insurer_offices o
    WHERE o.parent_office_id IS NULL

    UNION ALL

    -- Children: prepend parent's path + ' / '.
    SELECT
        c.id,
        c.insurer_id,
        c.parent_office_id,
        c.office_code,
        c.name,
        c.address,
        c.city,
        c.state,
        c.pin,
        c.gstin,
        c.phone,
        c.email,
        c.contact_person,
        c.is_active,
        c.display_order,
        c.office_short_code,
        c.type,
        c.created_at,
        (p.hierarchy_path || ' / ' || c.name)::TEXT AS hierarchy_path,
        p.depth + 1                                 AS depth
    FROM public.insurer_offices c
    INNER JOIN office_tree p ON c.parent_office_id = p.id
)
SELECT * FROM office_tree;

COMMENT ON VIEW public.v_insurer_offices_with_path IS
  'Recursive expansion of insurer_offices. Adds hierarchy_path (slash-joined chain of office names from root) and depth (1=root). Use this view for any UI/endpoint that needs to render an office with its parent context.';

COMMENT ON COLUMN public.insurer_offices.office_code IS
  '7-value enum: HO/RO/LCBO/ZO/RCH/CCH/BO. Source of truth for hierarchy. Legacy `type` is mirrored from this via trigger.';
COMMENT ON COLUMN public.insurer_offices.parent_office_id IS
  'Self-FK to insurer_offices(id). NULL only for HO (and orphans). ON DELETE SET NULL so removing a parent does not cascade-delete children — they surface as orphans for the clerk to re-parent.';
COMMENT ON COLUMN public.insurer_offices.is_active IS
  'Soft-delete flag. Inactive offices are hidden from default search but kept for FK integrity on historical claims.';
COMMENT ON COLUMN public.insurer_offices.display_order IS
  'Optional sort hint within a (insurer, office_code) group. 0 = default. Lower values list first.';
COMMENT ON COLUMN public.insurer_offices.office_short_code IS
  'Optional human-friendly short identifier (e.g. "MUM-RO-01") for ops use. Free text, no uniqueness constraint.';

-- Tell PostgREST to refresh its schema cache so the new columns + view are
-- visible to the JS client without a redeploy.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- =============================================================================
-- migration_policies_insurer_office.sql
-- =============================================================================
-- Adds the missing `insurer_office` column to the `policies` table.
--
-- The policy-master page (app/policy-master/page.js) has an "Insurer Office"
-- dropdown that is populated from the selected insurer's insurer_offices list,
-- and the POST /api/policies route whitelists `insurer_office` as an insertable
-- column. However, the `policies` table schema was never updated to include
-- this column — so saving a policy with a selected insurer office fails with:
--
--     Could not find the 'insurer_office' column of 'policies' in the schema cache
--
-- which surfaces in the UI as "Failed: C..." (truncated alert).
--
-- Idempotent: safe to run multiple times.
-- =============================================================================

BEGIN;

ALTER TABLE policies
    ADD COLUMN IF NOT EXISTS insurer_office TEXT;

COMMENT ON COLUMN policies.insurer_office IS
    'Name of the insurer office/branch handling this policy. Free-text — typically picked from the insurer_offices list tied to the chosen insurer, but also manually editable.';

-- Reload PostgREST / Supabase schema cache so the new column becomes visible
-- to the REST API immediately (otherwise the first few inserts after the
-- migration will still fail with the schema-cache error above).
NOTIFY pgrst, 'reload schema';

COMMIT;

-- =============================================================================
-- DONE. Verify with:
--   \d policies
-- and confirm insurer_office is present.
-- =============================================================================

-- =============================================================================
-- 20260503040000_insurer_session_helpers.sql
-- =============================================================================
-- Phase 3 RLS scaffolding — session-claim helpers.
--
-- The portal's auth lives in app_users + sessionStorage; we don't have
-- Supabase Auth JWTs available to RLS policies via auth.uid(). This
-- migration introduces SECURITY DEFINER helpers that:
--
--   - Set per-session Postgres GUCs (`app.user_email`, `app.user_role`,
--     `app.user_insurer_id`) from a single email lookup. The insurer-portal
--     routes call this at the top of each request via
--     supabase.rpc('set_session_user', { p_email: <user.email> }).
--
--   - Read those GUCs in RLS policy bodies via current_user_role() /
--     current_user_insurer_id(). Both return NULL when no session has
--     been established (e.g. service-role connections from the surveyor
--     flow, where RLS is bypassed anyway, or anon connections without
--     an explicit session set).
--
-- Why GUCs instead of `current_setting('request.jwt.claims', true)`:
--   - We don't issue JWTs (custom auth via app_users). Phase 4 may
--     migrate to Supabase Auth + JWTs; until then GUC is the right
--     primitive.
--   - GUC values reset at the end of each transaction (SET LOCAL) or
--     each connection (SET) so there's no leakage across requests.
--
-- See docs/insurer-portal-rls-spec.md for the rollout plan.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. set_session_user(p_email TEXT)
-- -----------------------------------------------------------------------------
-- Looks up the app_users row by case-insensitive email, validates that
-- it's active, and sets three session GUCs:
--   app.user_email
--   app.user_role
--   app.user_insurer_id  (string-cast of the BIGINT, or '' if null)
--
-- SECURITY DEFINER so anon-key callers can invoke it (the function runs
-- with the migration owner's privileges, then sets the local GUCs that
-- subsequent queries on the same connection will see).
--
-- Returns the user's role on success, NULL if the email isn't known
-- or is inactive (so callers can fail closed).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_session_user(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT;
    v_insurer_id BIGINT;
BEGIN
    IF p_email IS NULL OR p_email = '' THEN
        RETURN NULL;
    END IF;

    SELECT role, insurer_id
      INTO v_role, v_insurer_id
      FROM public.app_users
     WHERE LOWER(email) = LOWER(TRIM(p_email))
       AND is_active = TRUE
     LIMIT 1;

    IF v_role IS NULL THEN
        -- Unknown / inactive user. Clear any leaked GUCs explicitly.
        PERFORM set_config('app.user_email', '', TRUE);
        PERFORM set_config('app.user_role', '', TRUE);
        PERFORM set_config('app.user_insurer_id', '', TRUE);
        RETURN NULL;
    END IF;

    -- TRUE = SET LOCAL semantics (GUC reset at end of transaction).
    PERFORM set_config('app.user_email', LOWER(TRIM(p_email)), TRUE);
    PERFORM set_config('app.user_role', v_role, TRUE);
    PERFORM set_config('app.user_insurer_id',
                       COALESCE(v_insurer_id::TEXT, ''), TRUE);

    RETURN v_role;
END;
$$;

-- Grant execute to anon + authenticated so PostgREST callers can invoke.
GRANT EXECUTE ON FUNCTION public.set_session_user(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.set_session_user(TEXT)
    IS 'Phase 3 RLS — sets app.user_email/role/insurer_id GUCs from app_users row. Called by insurer-portal routes at request start so RLS policies can reference current_user_role() / current_user_insurer_id().';

-- -----------------------------------------------------------------------------
-- 2. current_user_role() — read-side getter
-- -----------------------------------------------------------------------------
-- Returns the role string set by set_session_user(), or NULL if no
-- session has been established (e.g. service-role connection, or an
-- anon connection that didn't call set_session_user). RLS policies use
-- this to distinguish "insurer-portal request" from "everything else".
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('app.user_role', TRUE), '');
$$;

GRANT EXECUTE ON FUNCTION public.current_user_role() TO anon, authenticated;

COMMENT ON FUNCTION public.current_user_role()
    IS 'Returns the role GUC set by set_session_user() or NULL when no session has been established. Used in RLS policy WHERE clauses.';

-- -----------------------------------------------------------------------------
-- 3. current_user_insurer_id() — read-side getter
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_insurer_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('app.user_insurer_id', TRUE), '')::BIGINT;
$$;

GRANT EXECUTE ON FUNCTION public.current_user_insurer_id() TO anon, authenticated;

COMMENT ON FUNCTION public.current_user_insurer_id()
    IS 'Returns the insurer_id GUC set by set_session_user(), cast to BIGINT. NULL for non-insurer principals.';

-- -----------------------------------------------------------------------------
-- 4. current_user_insurer_name() — convenience for policies that filter
-- claims by claims.insurer_name (which holds the same string as
-- insurers.company_name). One join saved per RLS check.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_insurer_name()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT i.company_name
      FROM public.insurers i
     WHERE i.id = public.current_user_insurer_id()
     LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.current_user_insurer_name() TO anon, authenticated;

COMMENT ON FUNCTION public.current_user_insurer_name()
    IS 'Resolves the insurer_id GUC to the insurers.company_name. Cached implicitly per query.';

-- =============================================================================
-- 20260503070000_longtail_rls_visible.sql
-- =============================================================================
-- Phase 3b — RLS for tables PARTIALLY visible to insurer principals.
--
-- These tables hold data the insurer's claims-dealing officer can
-- legitimately see for *their own* claims:
--
--   - site_visits (header rows: visit dates, locations, observations
--     captured at the site — same data that already appears in the
--     claim-detail timeline)
--   - ila_drafts (only `status = 'approved'` rows — i.e. the ILA the
--     surveyor finalised; insurer never sees works-in-progress)
--   - ila_submissions (every row represents a final, signed submission;
--     no draft-vs-final filter needed)
--
-- Pattern (mirrors Phase 3a's claim_field_values / site_visit_photos shape):
--
--   SELECT — surveyor / staff / admin / service-role: permissive.
--            insurer_readonly: scoped via parent claim
--            (`EXISTS claims c WHERE c.id = X.claim_id
--                            AND c.insurer_name = current_user_insurer_name()`)
--   INSERT/UPDATE/DELETE — refused for insurer principals; permissive
--                          otherwise.
--
-- For ila_drafts the SELECT predicate adds `status = 'approved'` so
-- works-in-progress drafts stay invisible (matches the fsr_drafts
-- pattern from Phase 3a).
--
-- Rollback at the bottom of the file.
-- See docs/insurer-portal-rls-spec.md §"Phase 3b — long-tail tables".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. site_visits — header rows scoped via parent claim
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow all access to site_visits" ON public.site_visits;

CREATE POLICY "site_visits_rls_select" ON public.site_visits
    FOR SELECT
    USING (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
        OR EXISTS (
            SELECT 1 FROM public.claims c
             WHERE c.id = site_visits.claim_id
               AND c.insurer_name = public.current_user_insurer_name()
        )
    );

CREATE POLICY "site_visits_rls_insert" ON public.site_visits
    FOR INSERT
    WITH CHECK (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

CREATE POLICY "site_visits_rls_update" ON public.site_visits
    FOR UPDATE
    USING       (public.current_user_role() IS DISTINCT FROM 'insurer_readonly')
    WITH CHECK  (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

CREATE POLICY "site_visits_rls_delete" ON public.site_visits
    FOR DELETE
    USING (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

-- -----------------------------------------------------------------------------
-- 2. ila_drafts — insurer sees only `status = 'approved'` for their own claims
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow all access to ila_drafts" ON public.ila_drafts;

-- Same two-layer gate as claim_fsr_drafts (Phase 3a):
--   1. Parent claim must belong to the insurer
--   2. Only `status = 'approved'` rows surface — drafts/under_review stay hidden
CREATE POLICY "ila_drafts_rls_select" ON public.ila_drafts
    FOR SELECT
    USING (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
        OR (
            status = 'approved'
            AND EXISTS (
                SELECT 1 FROM public.claims c
                 WHERE c.id = ila_drafts.claim_id
                   AND c.insurer_name = public.current_user_insurer_name()
            )
        )
    );

CREATE POLICY "ila_drafts_rls_insert" ON public.ila_drafts
    FOR INSERT
    WITH CHECK (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

CREATE POLICY "ila_drafts_rls_update" ON public.ila_drafts
    FOR UPDATE
    USING       (public.current_user_role() IS DISTINCT FROM 'insurer_readonly')
    WITH CHECK  (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

CREATE POLICY "ila_drafts_rls_delete" ON public.ila_drafts
    FOR DELETE
    USING (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

-- -----------------------------------------------------------------------------
-- 3. ila_submissions — every row is a final signed submission
-- -----------------------------------------------------------------------------
-- No status filter needed — the table's existence-as-row is the
-- "submitted" signal (drafts live in ila_drafts).

DROP POLICY IF EXISTS "Allow all access to ila_submissions" ON public.ila_submissions;

CREATE POLICY "ila_submissions_rls_select" ON public.ila_submissions
    FOR SELECT
    USING (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
        OR EXISTS (
            SELECT 1 FROM public.claims c
             WHERE c.id = ila_submissions.claim_id
               AND c.insurer_name = public.current_user_insurer_name()
        )
    );

CREATE POLICY "ila_submissions_rls_insert" ON public.ila_submissions
    FOR INSERT
    WITH CHECK (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

CREATE POLICY "ila_submissions_rls_update" ON public.ila_submissions
    FOR UPDATE
    USING       (public.current_user_role() IS DISTINCT FROM 'insurer_readonly')
    WITH CHECK  (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

CREATE POLICY "ila_submissions_rls_delete" ON public.ila_submissions
    FOR DELETE
    USING (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

-- =============================================================================
-- Rollback (commented — keep alongside the forward migration).
-- =============================================================================
--   DROP POLICY IF EXISTS "site_visits_rls_select" ON public.site_visits;
--   DROP POLICY IF EXISTS "site_visits_rls_insert" ON public.site_visits;
--   DROP POLICY IF EXISTS "site_visits_rls_update" ON public.site_visits;
--   DROP POLICY IF EXISTS "site_visits_rls_delete" ON public.site_visits;
--   CREATE POLICY "Allow all access to site_visits" ON public.site_visits USING (true) WITH CHECK (true);
--
--   DROP POLICY IF EXISTS "ila_drafts_rls_select" ON public.ila_drafts;
--   DROP POLICY IF EXISTS "ila_drafts_rls_insert" ON public.ila_drafts;
--   DROP POLICY IF EXISTS "ila_drafts_rls_update" ON public.ila_drafts;
--   DROP POLICY IF EXISTS "ila_drafts_rls_delete" ON public.ila_drafts;
--   CREATE POLICY "Allow all access to ila_drafts" ON public.ila_drafts USING (true) WITH CHECK (true);
--
--   DROP POLICY IF EXISTS "ila_submissions_rls_select" ON public.ila_submissions;
--   DROP POLICY IF EXISTS "ila_submissions_rls_insert" ON public.ila_submissions;
--   DROP POLICY IF EXISTS "ila_submissions_rls_update" ON public.ila_submissions;
--   DROP POLICY IF EXISTS "ila_submissions_rls_delete" ON public.ila_submissions;
--   CREATE POLICY "Allow all access to ila_submissions" ON public.ila_submissions USING (true) WITH CHECK (true);
-- =============================================================================

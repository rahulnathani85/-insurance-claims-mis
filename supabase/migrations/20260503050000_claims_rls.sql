-- =============================================================================
-- 20260503050000_claims_rls.sql
-- =============================================================================
-- Phase 3a — RLS policies for claims-adjacent tables.
--
-- Strategy: keep the existing permissive default for surveyor / staff /
-- admin / cron flows (they continue to use service-role or the anon
-- key without setting a session GUC), and ADD restrictive scoping
-- when the session GUC `app.user_role` = 'insurer_readonly'.
--
-- Concretely, every read policy is:
--
--   USING (
--       public.current_user_role() <> 'insurer_readonly'
--       OR insurer_name = public.current_user_insurer_name()
--   )
--
-- and every write policy:
--
--   WITH CHECK (
--       public.current_user_role() IS NULL
--       OR public.current_user_role() <> 'insurer_readonly'
--   )
--
-- This means:
--
--   - Service-role connection (lib/supabaseAdmin) bypasses RLS — surveyor
--     routes are unaffected.
--   - Anon connection without set_session_user() call → current_user_role()
--     is NULL → permissive read + write (matches the existing
--     "Allow all access" baseline for app_users login lookups, etc).
--   - Anon connection that DID call set_session_user() with an
--     insurer_readonly principal → reads scoped to insurer's claims,
--     writes refused.
--
-- Drops the existing `Allow all access to claims` policy so the new
-- policies actually take effect.
--
-- Tables in this migration:
--   - claims                 (primary)
--   - claim_field_values     (provenance — scoped via parent claim_id)
--   - claim_fsr_drafts       (insurer sees only status='approved')
--   - site_visit_photos      (scoped via parent claim_id)
--
-- Tables NOT in this migration (deferred to Phase 3b — see
-- docs/insurer-portal-rls-spec.md long-tail section):
--   - claim_messages, claim_chat_messages, claim_ai_conversations
--     (NOT visible to insurer at all — internal NISLA chat)
--   - survey_fee_bills (NOT visible — separate accounts flow)
--   - marine_loss_sheets, loss_sheets (NOT visible — working drafts)
--   - claim_documents (visible to insurer via approved-FSR PDF only;
--     direct claim_documents query needs separate per-doc gating)
--   - site_visits header, claim_issues, ila_drafts, ila_submissions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. claims
-- -----------------------------------------------------------------------------

-- Drop the permissive baseline so the new policies bind.
DROP POLICY IF EXISTS "Allow all access to claims" ON public.claims;

-- SELECT — surveyors see all; insurers see only their own.
CREATE POLICY "claims_rls_select" ON public.claims
    FOR SELECT
    USING (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
        OR insurer_name = public.current_user_insurer_name()
    );

-- INSERT/UPDATE/DELETE — refused for insurer principals; everyone else
-- (including the anon-key surveyor flow) allowed.
CREATE POLICY "claims_rls_insert" ON public.claims
    FOR INSERT
    WITH CHECK (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
    );

CREATE POLICY "claims_rls_update" ON public.claims
    FOR UPDATE
    USING (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
    )
    WITH CHECK (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
    );

CREATE POLICY "claims_rls_delete" ON public.claims
    FOR DELETE
    USING (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
    );

-- -----------------------------------------------------------------------------
-- 2. claim_field_values (provenance ledger — scoped via parent claim)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow all access to claim_field_values" ON public.claim_field_values;

CREATE POLICY "claim_field_values_rls_select" ON public.claim_field_values
    FOR SELECT
    USING (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
        OR EXISTS (
            SELECT 1 FROM public.claims c
             WHERE c.id = claim_field_values.claim_id
               AND c.insurer_name = public.current_user_insurer_name()
        )
    );

CREATE POLICY "claim_field_values_rls_write" ON public.claim_field_values
    FOR ALL
    USING (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
    )
    WITH CHECK (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
    );

-- -----------------------------------------------------------------------------
-- 3. claim_fsr_drafts (insurer sees only status='approved')
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow all access to claim_fsr_drafts" ON public.claim_fsr_drafts;

-- The insurer-visible filter is two-layered:
--   1. The parent claim must belong to the insurer
--   2. Only `status = 'approved'` rows surface — in-progress drafts
--      stay hidden.
CREATE POLICY "claim_fsr_drafts_rls_select" ON public.claim_fsr_drafts
    FOR SELECT
    USING (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
        OR (
            status = 'approved'
            AND EXISTS (
                SELECT 1 FROM public.claims c
                 WHERE c.id = claim_fsr_drafts.claim_id
                   AND c.insurer_name = public.current_user_insurer_name()
            )
        )
    );

CREATE POLICY "claim_fsr_drafts_rls_write" ON public.claim_fsr_drafts
    FOR ALL
    USING (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
    )
    WITH CHECK (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
    );

-- -----------------------------------------------------------------------------
-- 4. site_visit_photos (scoped via parent claim_id)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow all access to site_visit_photos" ON public.site_visit_photos;

CREATE POLICY "site_visit_photos_rls_select" ON public.site_visit_photos
    FOR SELECT
    USING (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
        OR EXISTS (
            SELECT 1 FROM public.claims c
             WHERE c.id = site_visit_photos.claim_id
               AND c.insurer_name = public.current_user_insurer_name()
        )
    );

CREATE POLICY "site_visit_photos_rls_write" ON public.site_visit_photos
    FOR ALL
    USING (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
    )
    WITH CHECK (
        public.current_user_role() IS DISTINCT FROM 'insurer_readonly'
    );

-- -----------------------------------------------------------------------------
-- Rollback (commented — keep alongside the forward migration)
-- -----------------------------------------------------------------------------
-- If a Phase 3 break shows up in production, restore the pre-Phase-3
-- baseline by running:
--
--   DROP POLICY IF EXISTS "claims_rls_select" ON public.claims;
--   DROP POLICY IF EXISTS "claims_rls_insert" ON public.claims;
--   DROP POLICY IF EXISTS "claims_rls_update" ON public.claims;
--   DROP POLICY IF EXISTS "claims_rls_delete" ON public.claims;
--   CREATE POLICY "Allow all access to claims" ON public.claims
--       USING (true) WITH CHECK (true);
--
-- (and equivalent DROP/CREATE pairs for the other three tables).
-- =============================================================================

-- =============================================================================
-- 20260503060000_longtail_rls_internal.sql
-- =============================================================================
-- Phase 3b — RLS for tables NOT visible to insurer principals at all.
--
-- These tables hold internal NISLA workflow / AI co-pilot logs / accounts
-- artefacts / working drafts. Insurers should never see them via direct
-- query. Each table gets a uniform `FOR ALL` policy that refuses traffic
-- when the session GUC `app.user_role` = 'insurer_readonly':
--
--   USING       (current_user_role() IS DISTINCT FROM 'insurer_readonly')
--   WITH CHECK  (current_user_role() IS DISTINCT FROM 'insurer_readonly')
--
-- Why uniform refuse instead of per-operation policies:
--   - There's no row-shape filter for these tables (insurer never sees
--     ANY row), so SELECT/INSERT/UPDATE/DELETE all share the same gate.
--   - `FOR ALL` produces one policy row per table instead of four,
--     keeping pg_policies output tidy.
--
-- IS DISTINCT FROM (vs <>) handles the NULL case correctly:
--   - service-role: bypasses RLS entirely, never sees these policies
--   - anon-key + no set_session_user(): current_user_role() = NULL
--                                       → NULL IS DISTINCT FROM 'insurer_readonly' = TRUE
--                                       → policy passes (permissive)
--   - anon-key + set_session_user('officer@newindia.in'):
--                                       → 'insurer_readonly' IS DISTINCT FROM 'insurer_readonly' = FALSE
--                                       → policy refuses
--
-- Tables in this migration:
--
--   Tables with existing "Allow all access to X" baselines (DROP + CREATE):
--     - claim_chat_messages         (Slice 7 per-claim AI co-pilot)
--     - marine_loss_sheets          (Marine Hull working draft)
--     - marine_loss_sheet_items
--     - loss_sheets                 (Fire / Engineering loss working draft)
--     - loss_sheet_items
--
--   Tables without RLS enabled at all (ENABLE + CREATE):
--     - claim_messages              (older v11 — surveyor-to-surveyor chat)
--     - claim_ai_conversations      (older v14 — global AI Analyst tab)
--     - survey_fee_bills            (older v3 — accounts billing flow)
--     - claim_documents             (older v5 — internal doc tracking; insurer
--                                    sees the FSR via claim_fsr_drafts only)
--
-- Why claim_documents is "no insurer access at all":
--   The legacy claim_documents table is internal status tracking
--   (Pending / Generated / Uploaded / Sent) not an insurer-distribution
--   surface. The signed FSR PDF flows through claim_fsr_drafts (status =
--   'approved'), which Phase 3a already gated correctly. If we later
--   need to expose specific doc rows (e.g. policy copies the insurer
--   provided themselves) we add per-row gating in a follow-up migration.
--
-- Rollback: see commented block at the bottom of this file.
-- See docs/insurer-portal-rls-spec.md §"Phase 3b — long-tail tables".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. claim_chat_messages — Slice 7 per-claim AI co-pilot conversation log
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all access to claim_chat_messages" ON public.claim_chat_messages;

CREATE POLICY "claim_chat_messages_rls_no_insurer" ON public.claim_chat_messages
    FOR ALL
    USING       (public.current_user_role() IS DISTINCT FROM 'insurer_readonly')
    WITH CHECK  (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

-- -----------------------------------------------------------------------------
-- 2. marine_loss_sheets / marine_loss_sheet_items — working drafts (Marine Hull)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all access to marine_loss_sheets" ON public.marine_loss_sheets;

CREATE POLICY "marine_loss_sheets_rls_no_insurer" ON public.marine_loss_sheets
    FOR ALL
    USING       (public.current_user_role() IS DISTINCT FROM 'insurer_readonly')
    WITH CHECK  (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

DROP POLICY IF EXISTS "Allow all access to marine_loss_sheet_items" ON public.marine_loss_sheet_items;

CREATE POLICY "marine_loss_sheet_items_rls_no_insurer" ON public.marine_loss_sheet_items
    FOR ALL
    USING       (public.current_user_role() IS DISTINCT FROM 'insurer_readonly')
    WITH CHECK  (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

-- -----------------------------------------------------------------------------
-- 3. loss_sheets / loss_sheet_items — working drafts (Fire / Engineering)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all access to loss_sheets" ON public.loss_sheets;

CREATE POLICY "loss_sheets_rls_no_insurer" ON public.loss_sheets
    FOR ALL
    USING       (public.current_user_role() IS DISTINCT FROM 'insurer_readonly')
    WITH CHECK  (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

DROP POLICY IF EXISTS "Allow all access to loss_sheet_items" ON public.loss_sheet_items;

CREATE POLICY "loss_sheet_items_rls_no_insurer" ON public.loss_sheet_items
    FOR ALL
    USING       (public.current_user_role() IS DISTINCT FROM 'insurer_readonly')
    WITH CHECK  (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

-- -----------------------------------------------------------------------------
-- 4. claim_messages — older v11 surveyor-to-surveyor chat. RLS not yet enabled.
-- -----------------------------------------------------------------------------
ALTER TABLE public.claim_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "claim_messages_rls_no_insurer" ON public.claim_messages
    FOR ALL
    USING       (public.current_user_role() IS DISTINCT FROM 'insurer_readonly')
    WITH CHECK  (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

-- -----------------------------------------------------------------------------
-- 5. claim_ai_conversations — older v14 global AI Analyst tab. RLS not yet enabled.
-- -----------------------------------------------------------------------------
ALTER TABLE public.claim_ai_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "claim_ai_conversations_rls_no_insurer" ON public.claim_ai_conversations
    FOR ALL
    USING       (public.current_user_role() IS DISTINCT FROM 'insurer_readonly')
    WITH CHECK  (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

-- -----------------------------------------------------------------------------
-- 6. survey_fee_bills — older v3 accounts billing flow. RLS not yet enabled.
-- -----------------------------------------------------------------------------
ALTER TABLE public.survey_fee_bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "survey_fee_bills_rls_no_insurer" ON public.survey_fee_bills
    FOR ALL
    USING       (public.current_user_role() IS DISTINCT FROM 'insurer_readonly')
    WITH CHECK  (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

-- -----------------------------------------------------------------------------
-- 7. claim_documents — older v5 internal doc-status tracker. RLS not yet enabled.
-- -----------------------------------------------------------------------------
-- NOTE: this is the LEGACY tracker (Pending/Generated/Uploaded/Sent
-- status per doc_type per claim). The insurer sees the signed FSR PDF
-- via claim_fsr_drafts (status='approved') only. If a future requirement
-- needs to expose specific doc rows to the insurer (e.g. policy copies),
-- relax this with a per-row gate then.
ALTER TABLE public.claim_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "claim_documents_rls_no_insurer" ON public.claim_documents
    FOR ALL
    USING       (public.current_user_role() IS DISTINCT FROM 'insurer_readonly')
    WITH CHECK  (public.current_user_role() IS DISTINCT FROM 'insurer_readonly');

-- =============================================================================
-- Rollback (commented — keep alongside the forward migration).
-- =============================================================================
-- If a Phase 3b break shows up in production, restore the pre-Phase-3b
-- baseline by running:
--
--   -- Tables that previously had explicit "Allow all access":
--   DROP POLICY IF EXISTS "claim_chat_messages_rls_no_insurer" ON public.claim_chat_messages;
--   CREATE POLICY "Allow all access to claim_chat_messages" ON public.claim_chat_messages USING (true) WITH CHECK (true);
--
--   DROP POLICY IF EXISTS "marine_loss_sheets_rls_no_insurer" ON public.marine_loss_sheets;
--   CREATE POLICY "Allow all access to marine_loss_sheets" ON public.marine_loss_sheets USING (true) WITH CHECK (true);
--
--   DROP POLICY IF EXISTS "marine_loss_sheet_items_rls_no_insurer" ON public.marine_loss_sheet_items;
--   CREATE POLICY "Allow all access to marine_loss_sheet_items" ON public.marine_loss_sheet_items USING (true) WITH CHECK (true);
--
--   DROP POLICY IF EXISTS "loss_sheets_rls_no_insurer" ON public.loss_sheets;
--   CREATE POLICY "Allow all access to loss_sheets" ON public.loss_sheets USING (true) WITH CHECK (true);
--
--   DROP POLICY IF EXISTS "loss_sheet_items_rls_no_insurer" ON public.loss_sheet_items;
--   CREATE POLICY "Allow all access to loss_sheet_items" ON public.loss_sheet_items USING (true) WITH CHECK (true);
--
--   -- Tables where Phase 3b first enabled RLS — disable to restore baseline:
--   DROP POLICY IF EXISTS "claim_messages_rls_no_insurer" ON public.claim_messages;
--   ALTER TABLE public.claim_messages DISABLE ROW LEVEL SECURITY;
--
--   DROP POLICY IF EXISTS "claim_ai_conversations_rls_no_insurer" ON public.claim_ai_conversations;
--   ALTER TABLE public.claim_ai_conversations DISABLE ROW LEVEL SECURITY;
--
--   DROP POLICY IF EXISTS "survey_fee_bills_rls_no_insurer" ON public.survey_fee_bills;
--   ALTER TABLE public.survey_fee_bills DISABLE ROW LEVEL SECURITY;
--
--   DROP POLICY IF EXISTS "claim_documents_rls_no_insurer" ON public.claim_documents;
--   ALTER TABLE public.claim_documents DISABLE ROW LEVEL SECURITY;
-- =============================================================================

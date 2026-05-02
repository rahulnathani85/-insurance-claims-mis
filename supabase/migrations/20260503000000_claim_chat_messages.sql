-- =============================================================================
-- 20260503000000_claim_chat_messages.sql
-- =============================================================================
-- Slice 7 — claim_chat_messages: per-claim AI co-pilot conversation log.
--
-- Distinct from `claim_messages` (the existing surveyor-to-surveyor chat
-- table) and `claim_ai_conversations` (the global AI Analyst tab). This
-- one is specifically for the per-claim chat copilot that lives on the
-- FSR drafting flow:
--   - The surveyor types a message → /api/ai/claim-chat persists it,
--     calls Claude/Gemini with full claim context, persists the
--     assistant reply with structured proposedChanges, returns both.
--   - The surveyor accepts/rejects each proposedChange. Accepted
--     changes route through lib/provenance/dualWrite (for field
--     changes), claim_fsr_drafts.narrative_jsonb (for narrative
--     edits), or marine_loss_sheets / loss_sheets (for computation
--     tweaks). Each accept/reject is logged back into the same row's
--     applied_changes JSONB so the panel knows which were taken up.
--
-- Why a new table rather than reusing claim_ai_conversations:
--   - That table's schema is global-AI-Analyst-shaped (no
--     proposedChanges, no applied_changes, no context discriminator).
--   - Schema migration would touch the existing AI Analyst flow.
--   - Cleaner to have purpose-shaped per-feature tables.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.claim_chat_messages (
    id                  BIGSERIAL    PRIMARY KEY,
    claim_id            BIGINT       NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,

    -- The user the message is from. For role='assistant' this is null.
    role                TEXT         NOT NULL,            -- 'user' | 'assistant'
    user_email          TEXT,                              -- for role='user'
    user_name           TEXT,                              -- denormalised, optional

    content             TEXT         NOT NULL,             -- the plain-text body

    -- Structured edits the assistant proposes alongside its reply.
    -- Shape per item documented in lib/fsr/chatPrompt.js:
    --   { type, path?, section?, currentValue, newValue, reason }
    proposed_changes    JSONB,

    -- After the surveyor accepts/rejects each proposed change, we record
    -- which were taken up so the UI doesn't ask twice.
    -- Shape: [{ index, status: 'accepted' | 'rejected', applied_at, applied_by, error? }]
    applied_changes     JSONB        NOT NULL DEFAULT '[]'::jsonb,

    -- Which assistant reply was made in response to which user message —
    -- mostly cosmetic but useful for the UI to render thread chains
    -- after a refresh.
    in_reply_to         BIGINT       REFERENCES public.claim_chat_messages(id) ON DELETE SET NULL,

    -- AI provenance — which model produced this assistant reply.
    -- Null for role='user'.
    ai_provider         TEXT,                              -- 'gemini' | 'claude' | etc.
    ai_model            TEXT,                              -- specific model id

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_chat_messages_role_check') THEN
        ALTER TABLE public.claim_chat_messages
            ADD CONSTRAINT claim_chat_messages_role_check
            CHECK (role IN ('user', 'assistant'));
    END IF;
END $$;

-- Hot path: load chat history for a claim, oldest-first.
CREATE INDEX IF NOT EXISTS idx_claim_chat_messages_claim
    ON public.claim_chat_messages (claim_id, created_at);

ALTER TABLE public.claim_chat_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'claim_chat_messages'
          AND policyname = 'Allow all access to claim_chat_messages'
    ) THEN
        CREATE POLICY "Allow all access to claim_chat_messages" ON public.claim_chat_messages
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.claim_chat_messages
    IS 'Slice 7: per-claim AI co-pilot conversation log. Distinct from claim_messages (surveyor-to-surveyor) and claim_ai_conversations (global AI Analyst).';

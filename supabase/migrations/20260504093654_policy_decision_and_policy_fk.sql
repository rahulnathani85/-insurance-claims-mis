-- ============================================================
-- Policy Registration Agent — schema additions
-- ------------------------------------------------------------
-- 1. claims.policy_id BIGINT FK -> policies(id) ON DELETE SET NULL
--    Structural link from claim to its resolved master policy.
--    NULL is valid (decision=ambiguous_needs_review, agent failed,
--    historical claims, etc.). Set by applyPolicyDecision at
--    registration submit time.
--
-- 2. claim_registration_extractions.policy_decision_json JSONB
--    Output from the Policy Agent persisted on the same row the
--    Claim Agent already populates. Rich shape: decision,
--    matched_policy_id, merged_policy_fields, conflicts,
--    new_policy_payload, review_reasons, reasoning.
--
-- Both additive + idempotent. No data backfill.
-- ============================================================

BEGIN;

-- 1. claims.policy_id ----------------------------------------
ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS policy_id BIGINT
    REFERENCES public.policies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_claims_policy_id
  ON public.claims (policy_id)
  WHERE policy_id IS NOT NULL;

COMMENT ON COLUMN public.claims.policy_id IS
  'Structural FK to policies(id), set by the Policy Registration Agent at registration submit. NULL when unresolved or pending review (decision=ambiguous_needs_review).';

-- 2. claim_registration_extractions.policy_decision_json -----
ALTER TABLE public.claim_registration_extractions
  ADD COLUMN IF NOT EXISTS policy_decision_json JSONB;

COMMENT ON COLUMN public.claim_registration_extractions.policy_decision_json IS
  'Output from the Policy Registration Agent (lib/comms/prompts/policyRegistrationAgentPrompt.js): { decision, matched_policy_id, merged_policy_fields, conflicts, new_policy_payload, review_reasons, reasoning }. Persisted on the same row as the Claim Agent extraction so both decisions stay together for audit + idempotency.';

COMMIT;

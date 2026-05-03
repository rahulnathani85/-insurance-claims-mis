-- ============================================================
-- claim_registration_extractions + claims.cause_of_loss
-- ------------------------------------------------------------
-- Backs the Registration Agent feature (rich on-demand LLM
-- extraction at /claim-registration/<id>):
--   1. Adds cause_of_loss column to claims (additive, nullable).
--   2. Creates claim_registration_extractions to store one row
--      per LLM extraction run, with the rich JSON shape:
--      { fields: { <name>: { value, confidence, source,
--                            raw_snippet } },
--        conflicts: [...], missing_critical: [...] }
--
-- History is kept (no upsert on claim_id) so a previous run is
-- always retrievable. The endpoint and UI always read the
-- newest row by created_at.
-- ============================================================

BEGIN;

-- 1. cause_of_loss on claims
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS cause_of_loss text;

COMMENT ON COLUMN claims.cause_of_loss IS
  'Distinct from peril_type: peril is the high-level cause class (Fire, Flood, Theft); cause_of_loss is the specific mechanism (short circuit, road accident, machinery breakdown).';

-- 2. claim_registration_extractions
CREATE TABLE IF NOT EXISTS claim_registration_extractions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id           bigint      NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  message_id         uuid        REFERENCES inbox_messages(id) ON DELETE SET NULL,
  fields_json        jsonb       NOT NULL,
  conflicts_json     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  missing_critical   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  extraction_notes   text,
  llm_provider       text,
  llm_model          text,
  llm_tokens_in      integer,
  llm_tokens_out     integer,
  llm_cost_inr       numeric,
  triggered_by       text,
  triggered_by_user  text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE claim_registration_extractions IS
  'Rich per-field LLM extraction for the registration form. One row per extraction run; latest row wins for UI display.';

CREATE INDEX IF NOT EXISTS claim_registration_extractions_claim_idx
  ON claim_registration_extractions (claim_id, created_at DESC);

CREATE INDEX IF NOT EXISTS claim_registration_extractions_message_idx
  ON claim_registration_extractions (message_id)
  WHERE message_id IS NOT NULL;

COMMIT;

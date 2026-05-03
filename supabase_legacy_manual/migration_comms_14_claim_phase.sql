-- ============================================================
-- migration_comms_14_claim_phase.sql
-- ------------------------------------------------------------
-- Adds an explicit lifecycle phase to claims so the system can
-- distinguish a freshly intimated claim (created from an email
-- intimation) from one that has been formally registered.
--
-- Allowed values: 'intimation', 'registered'.
--
-- Existing claims default to 'registered' (assumption: anything
-- already in the table predates the comms-driven intimation
-- flow and was created via the manual Claim Registration path).
-- New claims auto-created by /api/comms-cron/execute-routing
-- will be inserted with phase='intimation' and require a manual
-- Register step before they progress.
-- ============================================================

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'registered';

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS registered_by TEXT;

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ;

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS registration_note TEXT;

-- Phase whitelist. Drop-and-recreate so re-running the migration
-- is idempotent.
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_phase_check;
ALTER TABLE claims
  ADD CONSTRAINT claims_phase_check
  CHECK (phase IN ('intimation', 'registered'));

-- Index for the listing page that filters phase='intimation'.
CREATE INDEX IF NOT EXISTS idx_claims_phase_company
  ON claims (phase, company)
  WHERE phase = 'intimation';

COMMENT ON COLUMN claims.phase IS 'Lifecycle phase: intimation (created from comms) or registered (formally registered).';
COMMENT ON COLUMN claims.registered_by IS 'Email of the user who registered the claim (phase intimation -> registered).';
COMMENT ON COLUMN claims.registered_at IS 'When the claim was registered.';
COMMENT ON COLUMN claims.registration_note IS 'Optional note captured at registration time.';

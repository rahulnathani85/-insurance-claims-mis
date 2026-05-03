-- ============================================================
-- Comms Intelligence — Migration 6: OAuth state + ref patterns
-- SAFE: Purely additive. Idempotent.
-- ============================================================
-- Two small supporting tables used by Week 1 ingestion:
--
--   comms_oauth_state     — short-lived CSRF nonces for the new
--                           OAuth flows. 10-minute TTL; cleaned
--                           up opportunistically on writes.
--   comms_ref_patterns    — per-company regex patterns that
--                           identify claim references in message
--                           subjects/bodies. Used to filter the
--                           per-user opt-in stream so only
--                           claim-related messages are ingested
--                           from personal Gmail.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- comms_oauth_state
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comms_oauth_state (
  nonce         text        PRIMARY KEY,
  mode          text        NOT NULL,   -- 'shared' or 'user'
  company       text        NOT NULL,
  requested_by  text,                    -- app user email that initiated
  created_at    timestamptz NOT NULL DEFAULT now(),
  consumed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS comms_oauth_state_created_idx
  ON comms_oauth_state (created_at);

COMMENT ON TABLE comms_oauth_state IS
  'Short-lived CSRF nonces for Communications OAuth flows. Rows older than 10 minutes are treated as expired.';

-- ------------------------------------------------------------
-- comms_ref_patterns
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comms_ref_patterns (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company       text        NOT NULL,
  pattern       text        NOT NULL,   -- Postgres regex, case-insensitive
  description   text,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comms_ref_patterns_company_active_idx
  ON comms_ref_patterns (company, is_active);

-- Seed patterns: one generic per company. Admins can edit/add
-- more from the Settings UI in Week 6.
INSERT INTO comms_ref_patterns (company, pattern, description)
VALUES
  ('NISLA',  '\mNISLA[/-]?\d{4,}',  'NISLA claim reference (e.g. NISLA/2025/1234 or NISLA-1234)'),
  ('NISLA',  '\mC-\d{4}-\d{3,}',    'Short claim ref format (e.g. C-2025-0042)'),
  ('NISLA',  '\mEW[/-]?\d{4,}',     'Extended Warranty ref format'),
  ('Acuere', '\mACU[/-]?\d{4,}',    'Acuere claim reference'),
  ('Acuere', '\mC-\d{4}-\d{3,}',    'Short claim ref format')
ON CONFLICT DO NOTHING;

COMMIT;

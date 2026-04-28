-- ============================================================
-- Comms Intelligence — Migration 8: Kill switch config + audit
-- SAFE: Purely additive. Idempotent. Re-runnable.
-- ============================================================
-- Adds:
--   - comms_config: single-row table holding three pause flags
--                   (ingestion / classification / execution).
--                   Read by every cron + webhook entrypoint via
--                   lib/comms/killSwitch.assertCommsEnabled.
--   - mailbox_audit: append-only event log for mailbox connect /
--                    disconnect / pause / resume / opt-in / revoke.
--                    Mirrored to portal-wide activity_log via
--                    lib/comms/auditLog.recordMailboxEvent.
--
-- Both tables are scoped to the Comms module; no existing portal
-- table is altered.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- comms_config — singleton kill-switch state
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comms_config (
  id                       integer     PRIMARY KEY DEFAULT 1,
  ingestion_paused         boolean     NOT NULL DEFAULT false,
  classification_paused    boolean     NOT NULL DEFAULT false,
  execution_paused         boolean     NOT NULL DEFAULT false,
  ingestion_paused_at      timestamptz,
  classification_paused_at timestamptz,
  execution_paused_at      timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               text,
  CONSTRAINT comms_config_singleton CHECK (id = 1)
);

-- Seed the singleton row if missing. Re-running is a no-op.
INSERT INTO comms_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- mailbox_audit — append-only event log
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mailbox_audit (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event         text        NOT NULL,
  mailbox_email text,
  company       text,
  actor_email   text,
  details       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mailbox_audit_event_idx
  ON mailbox_audit (event, created_at DESC);

CREATE INDEX IF NOT EXISTS mailbox_audit_company_idx
  ON mailbox_audit (company, created_at DESC);

CREATE INDEX IF NOT EXISTS mailbox_audit_mailbox_idx
  ON mailbox_audit (mailbox_email, created_at DESC);

COMMIT;

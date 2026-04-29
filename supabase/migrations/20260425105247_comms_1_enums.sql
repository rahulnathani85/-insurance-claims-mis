-- ============================================================
-- Comms Intelligence — Migration 1: ENUMs
-- SAFE: Purely additive. Idempotent. Re-runnable.
-- ============================================================
-- Creates the four PostgreSQL ENUM types used by the
-- Communications Intelligence module. Wrapped in DO blocks so
-- re-running the migration does not error.
-- ============================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_source') THEN
    CREATE TYPE message_source AS ENUM (
      'email_gmail',
      'email_imap',
      'whatsapp_business',
      'whatsapp_personal',
      'manual_upload'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_status') THEN
    CREATE TYPE message_status AS ENUM (
      'received',
      'classifying',
      'pending_review',
      'auto_routed',
      'rejected',
      'error'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_tag') THEN
    CREATE TYPE workflow_tag AS ENUM (
      'intimation',
      'surveyor_photos',
      'site_visit_report',
      'insurer_query',
      'settlement_advice',
      'client_followup',
      'policy_doc',
      'internal_admin',
      'unclassified'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'action_status') THEN
    CREATE TYPE action_status AS ENUM (
      'pending',
      'in_progress',
      'completed',
      'failed',
      'skipped'
    );
  END IF;
END $$;

COMMIT;

-- ============================================================
-- migration_comms_11a_enum_extend.sql
-- Stage 5: Extend workflow_tag enum with new tag values.
--
-- IMPORTANT: Run this file FIRST and let it commit. Then run
-- migration_comms_11b_tag_updates.sql in a separate execution —
-- Postgres requires the new enum values to be committed before
-- they can be referenced in INSERT/UPDATE statements.
-- ============================================================

ALTER TYPE workflow_tag ADD VALUE IF NOT EXISTS 'duplicate';
ALTER TYPE workflow_tag ADD VALUE IF NOT EXISTS 'claim_documents';
ALTER TYPE workflow_tag ADD VALUE IF NOT EXISTS 'claim_registration';
ALTER TYPE workflow_tag ADD VALUE IF NOT EXISTS 'consent_email';
ALTER TYPE workflow_tag ADD VALUE IF NOT EXISTS 'update_from_insurer';
ALTER TYPE workflow_tag ADD VALUE IF NOT EXISTS 'others';

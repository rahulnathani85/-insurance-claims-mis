-- =============================================================================
-- 01_truncate_seed_data_on_new.sql
-- =============================================================================
-- Run this on the NEW project's SQL Editor BEFORE importing data from OLD.
--
-- The v5/v6 migrations seeded test data:
--   - 4 dev users in app_users (admin@nisla.in, surveyor@..., staff@..., dev@...)
--   - ~20 sample claims (DEV-001/26-27/* etc.) under company='Development'
--   - Sample claim_stages, claim_workflow rows
--   - Sample claim_categories
--   - Sample document_templates / fsr_templates / etc.
--
-- These would conflict with OLD's real data (PK collisions, duplicate names).
-- We truncate them here so the OLD import has a clean target.
--
-- We DO NOT truncate:
--   - lifecycle_* tables (seeded by lifecycle_engine.sql with template config
--     that the app needs)
--   - comms_ tables seeded with tag definitions
--   - These are reference / config data, not user data. OLD might not even
--     have them populated.
-- =============================================================================

BEGIN;

-- 1. App users (4 dev users)
TRUNCATE TABLE app_users RESTART IDENTITY CASCADE;

-- 2. Sample claims and dependent rows
TRUNCATE TABLE
    claims,
    claim_stages_archive,    -- claim_stages is now a view; underlying table is _archive
    claim_workflow_archive,
    claim_workflow_history_archive,
    claim_documents,
    claim_emails,
    claim_messages,
    claim_assignments,
    claim_reminders,
    claim_fsr_drafts,
    claim_ai_conversations,
    activity_log,
    survey_fee_bills,
    user_sessions,
    generated_documents,
    extraction_results,
    routing_executions,
    routing_actions,
    inbox_messages,
    message_attachments,
    message_classifications,
    message_reads,
    classification_runs,
    ai_call_log,
    email_drafts,
    ingestion_runs,
    mailbox_audit,
    ew_vehicle_claims,
    ew_claim_stages_archive,
    ew_claim_media,
    ew_lots,
    ew_lot_claims,
    ew_lot_counters,
    claim_lifecycle,
    claim_lifecycle_phases,
    claim_lifecycle_stages,
    claim_lifecycle_subtasks,
    claim_lifecycle_items,
    claim_lifecycle_history,
    bill_counters,
    ref_counters,
    marine_counters,
    global_chat_messages,
    global_chat_reads,
    gmail_tokens,
    comms_oauth_state,
    comms_config,
    comms_ref_patterns,
    tag_definitions,
    whatsapp_contacts
RESTART IDENTITY CASCADE;

-- Sanity check: should return 0 rows for all
SELECT
    'app_users' AS tbl, count(*) AS rows FROM app_users
UNION ALL SELECT 'claims', count(*) FROM claims
UNION ALL SELECT 'ew_vehicle_claims', count(*) FROM ew_vehicle_claims
UNION ALL SELECT 'inbox_messages', count(*) FROM inbox_messages
ORDER BY tbl;

COMMIT;

-- =============================================================================
-- 02_truncate_and_import_wrapper.sql
-- =============================================================================
-- Pre-amble to run inside a SINGLE TRANSACTION before \i old_data_dump.sql
-- (or inside the same psql --single-transaction invocation as the dump).
--
-- Purpose:
--   - Disable FK / trigger checks so the dump's INSERTs survive circular FKs
--     (claims <-> inbox_messages, lifecycle_templates self-ref, etc.)
--   - Wipe the seed data we don't want (v5/v6 dev users, sample claims, etc.)
--   - DOES NOT wrap in BEGIN/COMMIT — the calling psql session controls the
--     transaction via --single-transaction so the WHOLE import is atomic.
-- =============================================================================

SET session_replication_role = 'replica';

-- Wipe everything that v5/v6 seeded, plus anything Vercel cron may have written
-- into the NEW DB between cutover and now (so the OLD dump's INSERTs don't
-- collide on PK values like id=1 in activity_log).
TRUNCATE TABLE
    app_users,
    claims,
    claim_stages_archive,
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
    whatsapp_contacts,
    insurers,
    insurer_offices,
    policies,
    policy_types,
    brokers,
    surveyors,
    fsr_templates,
    document_templates,
    claim_categories,
    doc_types,
    ew_document_categories,
    gipsa_fee_schedule,
    lifecycle_item_catalog,
    lifecycle_template_default_items,
    lifecycle_template_stage_branches,
    lifecycle_template_stage_subtasks,
    lifecycle_template_stages,
    lifecycle_template_time_rules,
    lifecycle_templates
RESTART IDENTITY CASCADE;

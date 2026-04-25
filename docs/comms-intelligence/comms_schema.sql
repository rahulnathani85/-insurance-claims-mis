-- ============================================================================
-- NISLA Communications Intelligence — Database Schema
-- ============================================================================
-- Target: PostgreSQL 14+ / Supabase
-- Designed to integrate with the existing NISLA Operations Portal database
-- and link to the claims table from the Archive AI schema.
--
-- Migration file: 20260422_comms_intelligence.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE message_source AS ENUM (
  'email_gmail',
  'email_imap',
  'whatsapp_business',
  'whatsapp_personal',
  'manual_upload'
);

CREATE TYPE message_status AS ENUM (
  'received',           -- raw, not yet classified
  'classifying',        -- in flight to LLM
  'pending_review',     -- classified but needs human approval
  'auto_routed',        -- approved (auto or manual), actions executed
  'rejected',           -- spam / out of scope
  'error'               -- processing failed
);

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

CREATE TYPE action_status AS ENUM (
  'pending',
  'in_progress',
  'completed',
  'failed',
  'skipped'
);

-- ============================================================================
-- TABLE: tag_definitions
-- ============================================================================
-- Configurable tag library. Each tag defines its extraction schema and
-- the routing actions to perform when applied. Editable from the portal so
-- new tags can be added without code changes.
-- ============================================================================

CREATE TABLE tag_definitions (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tag             workflow_tag  NOT NULL UNIQUE,
  display_label   text          NOT NULL,
  short_code      text          NOT NULL,           -- e.g., 'INT', 'SET'
  description     text          NOT NULL,
  ui_color        text          NOT NULL DEFAULT 'slate',
  classifier_prompt text        NOT NULL,           -- prompt fragment for the classifier
  extraction_schema jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- field name -> {type, required, hint}
  routing_actions jsonb         NOT NULL DEFAULT '[]'::jsonb,  -- array of {action_type, params}
  auto_route_threshold numeric(3,2) NOT NULL DEFAULT 0.90,    -- confidence above which to skip review
  enabled         boolean       NOT NULL DEFAULT true,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE tag_definitions IS 'Configurable tag library — defines what each workflow tag means, what to extract, and what to do.';
COMMENT ON COLUMN tag_definitions.auto_route_threshold IS 'If classifier confidence >= this, skip human review and auto-route.';

-- ============================================================================
-- TABLE: inbox_messages
-- ============================================================================
-- Every incoming email or WhatsApp message lands here as a raw record.
-- One row per inbound message. Source-specific identifiers stored to enable
-- idempotent re-ingestion.
-- ============================================================================

CREATE TABLE inbox_messages (
  id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  source          message_source    NOT NULL,
  source_msg_id   text              NOT NULL,         -- Gmail msg id / WA msg id
  thread_id       text,                                -- Gmail thread id / WA chat id
  from_address    text              NOT NULL,         -- email or phone number
  from_display    text,                                -- name as parsed from header
  to_address      text,
  cc_addresses    text[]            DEFAULT ARRAY[]::text[],
  subject         text,
  body_plain      text              NOT NULL DEFAULT '',
  body_html       text,
  received_at     timestamptz       NOT NULL,
  raw_headers     jsonb,
  attachments_count integer         NOT NULL DEFAULT 0,
  status          message_status    NOT NULL DEFAULT 'received',
  ingested_at     timestamptz       NOT NULL DEFAULT now(),
  CONSTRAINT inbox_messages_unique_per_source UNIQUE (source, source_msg_id)
);

CREATE INDEX inbox_messages_received_at_idx ON inbox_messages (received_at DESC);
CREATE INDEX inbox_messages_status_idx ON inbox_messages (status) WHERE status IN ('received', 'pending_review');
CREATE INDEX inbox_messages_thread_idx ON inbox_messages (thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX inbox_messages_from_idx ON inbox_messages (from_address);
CREATE INDEX inbox_messages_body_fts ON inbox_messages USING gin (to_tsvector('english', coalesce(subject, '') || ' ' || body_plain));

COMMENT ON TABLE inbox_messages IS 'Raw inbox — every email and WhatsApp message captured here before processing.';
COMMENT ON COLUMN inbox_messages.source_msg_id IS 'Gmail message id, WhatsApp message id, etc. Used for idempotency.';

-- ============================================================================
-- TABLE: message_attachments
-- ============================================================================
-- One row per attached file. Files are stored in Supabase Storage; this table
-- holds metadata and the storage path. Hashed for dedup.
-- ============================================================================

CREATE TABLE message_attachments (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      uuid          NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
  filename        text          NOT NULL,
  mime_type       text          NOT NULL,
  size_bytes      bigint        NOT NULL,
  storage_path    text          NOT NULL,         -- supabase storage key
  sha256_hash     text          NOT NULL,
  is_image        boolean       NOT NULL DEFAULT false,
  exif_json       jsonb,                          -- if image
  ocr_text        text,                           -- if PDF/image with text
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX message_attachments_message_idx ON message_attachments (message_id);
CREATE INDEX message_attachments_hash_idx ON message_attachments (sha256_hash);

COMMENT ON TABLE message_attachments IS 'Files attached to inbox messages. Stored in Supabase Storage; metadata here.';

-- ============================================================================
-- TABLE: message_classifications
-- ============================================================================
-- One row per classification attempt. Multiple rows possible per message
-- (e.g., re-classification after manual override or retry). Most recent row
-- with is_active = true is the current classification.
-- ============================================================================

CREATE TABLE message_classifications (
  id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      uuid              NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
  tag             workflow_tag      NOT NULL,
  confidence      numeric(4,3)      NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  classifier_model text             NOT NULL,    -- e.g., 'claude-sonnet-4-20250514'
  reasoning       text,                          -- short LLM reasoning
  classified_at   timestamptz       NOT NULL DEFAULT now(),
  classified_by   text              NOT NULL DEFAULT 'auto',  -- 'auto' or user uuid
  is_active       boolean           NOT NULL DEFAULT true,
  override_reason text                            -- if manual override
);

CREATE INDEX message_classifications_message_idx ON message_classifications (message_id, is_active);
CREATE INDEX message_classifications_tag_idx ON message_classifications (tag);

-- Trigger to ensure only one active classification per message
CREATE OR REPLACE FUNCTION ensure_single_active_classification()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE message_classifications
       SET is_active = false
     WHERE message_id = NEW.message_id
       AND id != NEW.id
       AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_single_active_classification
  AFTER INSERT OR UPDATE ON message_classifications
  FOR EACH ROW EXECUTE FUNCTION ensure_single_active_classification();

COMMENT ON TABLE message_classifications IS 'Classification history per message. Only one row per message has is_active=true.';

-- ============================================================================
-- TABLE: extraction_results
-- ============================================================================
-- Structured fields extracted by the LLM, validated against the tag's
-- extraction_schema. Stored as JSONB for flexibility but with field-level
-- access via GIN index.
-- ============================================================================

CREATE TABLE extraction_results (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      uuid          NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
  classification_id uuid        NOT NULL REFERENCES message_classifications(id) ON DELETE CASCADE,
  tag             workflow_tag  NOT NULL,
  extracted_data  jsonb         NOT NULL DEFAULT '{}'::jsonb,
  validation_errors jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- array of {field, error}
  is_valid        boolean       NOT NULL DEFAULT true,
  edited_by_user  boolean       NOT NULL DEFAULT false,
  edited_at       timestamptz,
  edited_by       text,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX extraction_results_message_idx ON extraction_results (message_id);
CREATE INDEX extraction_results_data_gin ON extraction_results USING gin (extracted_data);

COMMENT ON TABLE extraction_results IS 'Structured fields extracted from message body, validated against tag schema.';

-- ============================================================================
-- TABLE: routing_actions
-- ============================================================================
-- One row per action taken (or attempted) as a result of a classification.
-- Forms the audit trail of what the system did with each message.
-- ============================================================================

CREATE TABLE routing_actions (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      uuid          NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
  classification_id uuid        NOT NULL REFERENCES message_classifications(id) ON DELETE CASCADE,
  action_type     text          NOT NULL,        -- 'create_claim', 'attach_to_claim', 'send_email', 'notify_whatsapp', etc.
  action_params   jsonb         NOT NULL DEFAULT '{}'::jsonb,
  destination_table text,                         -- which table got written to (if any)
  destination_id  uuid,                           -- which row id (if any)
  status          action_status NOT NULL DEFAULT 'pending',
  attempted_at    timestamptz,
  completed_at    timestamptz,
  error_message   text,
  retry_count     integer       NOT NULL DEFAULT 0,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX routing_actions_message_idx ON routing_actions (message_id);
CREATE INDEX routing_actions_status_idx ON routing_actions (status) WHERE status IN ('pending', 'in_progress', 'failed');
CREATE INDEX routing_actions_destination_idx ON routing_actions (destination_table, destination_id);

COMMENT ON TABLE routing_actions IS 'Audit trail of every action taken in response to a classified message.';

-- ============================================================================
-- TABLE: whatsapp_contacts
-- ============================================================================
-- Track WhatsApp contacts so we can show display names instead of phone numbers
-- and identify whether the sender is a surveyor, client, or insurer rep.
-- ============================================================================

CREATE TABLE whatsapp_contacts (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number    text          NOT NULL UNIQUE,
  display_name    text,
  contact_type    text          NOT NULL DEFAULT 'unknown',  -- 'surveyor', 'client', 'insurer', 'internal', 'unknown'
  linked_user_id  uuid,                                       -- if this is a NISLA team member
  notes           text,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX whatsapp_contacts_type_idx ON whatsapp_contacts (contact_type);

COMMENT ON TABLE whatsapp_contacts IS 'Known WhatsApp contacts — used to identify message senders and route appropriately.';

-- ============================================================================
-- TABLE: ingestion_runs
-- ============================================================================
-- Each polling cycle (Gmail or WA) creates a row here. Useful for monitoring
-- whether the worker is actually running.
-- ============================================================================

CREATE TABLE ingestion_runs (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  source          message_source NOT NULL,
  started_at      timestamptz   NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  messages_fetched integer      NOT NULL DEFAULT 0,
  messages_new    integer       NOT NULL DEFAULT 0,
  messages_failed integer       NOT NULL DEFAULT 0,
  error_message   text,
  cursor_after    text                          -- last seen msg id / timestamp for next poll
);

CREATE INDEX ingestion_runs_source_started_idx ON ingestion_runs (source, started_at DESC);

COMMENT ON TABLE ingestion_runs IS 'One row per polling/webhook cycle. Used for monitoring worker health.';

-- ============================================================================
-- VIEWS — convenient combined data for the UI
-- ============================================================================

CREATE OR REPLACE VIEW v_inbox_with_classification AS
SELECT
  m.id                  AS message_id,
  m.source,
  m.from_address,
  m.from_display,
  m.subject,
  m.body_plain,
  m.received_at,
  m.attachments_count,
  m.status              AS message_status,
  c.tag                 AS auto_tag,
  c.confidence,
  c.reasoning,
  c.classified_at,
  e.extracted_data,
  e.is_valid            AS extraction_valid,
  td.display_label      AS tag_label,
  td.routing_actions    AS proposed_actions
FROM inbox_messages m
LEFT JOIN message_classifications c
  ON c.message_id = m.id AND c.is_active = true
LEFT JOIN extraction_results e
  ON e.classification_id = c.id
LEFT JOIN tag_definitions td
  ON td.tag = c.tag;

COMMENT ON VIEW v_inbox_with_classification IS 'Single-row-per-message view combining classification, extraction, and tag metadata for UI consumption.';

CREATE OR REPLACE VIEW v_today_processing_stats AS
SELECT
  c.tag,
  count(*) FILTER (WHERE m.status = 'auto_routed')      AS auto_routed_count,
  count(*) FILTER (WHERE m.status = 'pending_review')   AS pending_review_count,
  count(*) FILTER (WHERE m.status = 'error')            AS error_count,
  avg(c.confidence)                                     AS avg_confidence
FROM inbox_messages m
JOIN message_classifications c
  ON c.message_id = m.id AND c.is_active = true
WHERE m.received_at >= current_date
GROUP BY c.tag;

COMMENT ON VIEW v_today_processing_stats IS 'Per-tag stats for today, used in the dashboard header.';

-- ============================================================================
-- TRIGGER: updated_at maintenance
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tag_definitions_updated
  BEFORE UPDATE ON tag_definitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_whatsapp_contacts_updated
  BEFORE UPDATE ON whatsapp_contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY (Supabase) — restrict reads/writes to authenticated NISLA staff
-- ============================================================================

ALTER TABLE inbox_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_attachments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_results     ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_actions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag_definitions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_runs         ENABLE ROW LEVEL SECURITY;

-- Sample policy: any authenticated user can read messages they're allowed to see.
-- Tighten later based on roles (intelligence_read vs admin) once roles are defined.
CREATE POLICY "authenticated_read" ON inbox_messages
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read" ON message_classifications
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read" ON extraction_results
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read" ON routing_actions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read" ON tag_definitions
  FOR SELECT TO authenticated USING (true);

-- Only service role can insert/update/delete (worker writes via service_role key)
-- Authenticated users get write access via specific RPC functions, not direct table writes.

-- ============================================================================
-- SEED: Initial tag library
-- ============================================================================

INSERT INTO tag_definitions (tag, display_label, short_code, description, ui_color, classifier_prompt, extraction_schema, routing_actions, auto_route_threshold) VALUES
('intimation', 'New Intimation', 'INT', 'New claim notification from insurer', 'blue',
 'A new claim is being intimated for survey. Look for policy number, insured name, vehicle/property details, date of loss, location, sum insured, and a request for survey.',
 '{
   "policy_no": {"type": "string", "required": true, "hint": "policy number from insurer"},
   "insured_name": {"type": "string", "required": true, "hint": "name of insured person/entity"},
   "vehicle_or_property": {"type": "string", "required": true, "hint": "what is being claimed against"},
   "date_of_loss": {"type": "date", "required": true, "hint": "ISO 8601 date"},
   "location": {"type": "string", "required": true, "hint": "where the loss occurred"},
   "contact": {"type": "string", "required": false, "hint": "phone or email of insured"},
   "sum_insured": {"type": "string", "required": false, "hint": "total sum insured under policy"},
   "lob": {"type": "enum", "required": true, "hint": "Motor OD, Fire, Marine Cargo, etc."}
 }'::jsonb,
 '[
   {"action_type": "create_claim", "params": {"status": "intimated"}},
   {"action_type": "assign_surveyor", "params": {"strategy": "round_robin_by_lob"}},
   {"action_type": "send_email", "params": {"template": "intimation_acknowledgement", "to": "from_address"}},
   {"action_type": "notify_whatsapp", "params": {"to": "assigned_surveyor", "template": "new_assignment"}}
 ]'::jsonb,
 0.92),

('surveyor_photos', 'Surveyor Photos', 'PHO', 'Inspection photos from field team', 'violet',
 'Photos of damaged vehicle/property received from a NISLA surveyor or field team member. Look for claim reference and identify the source as a surveyor.',
 '{
   "claim_ref": {"type": "string", "required": true, "hint": "NISLA claim ID or external ref"},
   "photo_count": {"type": "integer", "required": true, "hint": "number of photos attached"},
   "location_metadata": {"type": "string", "required": false, "hint": "from EXIF or message body"},
   "capture_date": {"type": "date", "required": false, "hint": "from EXIF"}
 }'::jsonb,
 '[
   {"action_type": "attach_photos_to_claim", "params": {}},
   {"action_type": "run_vision_captioning", "params": {"model": "claude-sonnet"}},
   {"action_type": "update_claim_gallery", "params": {}}
 ]'::jsonb,
 0.90),

('site_visit_report', 'Site Visit Report', 'SVR', 'Preliminary observations from field team', 'indigo',
 'Surveyor reporting back from a site visit. Will mention cause of loss, observations, and possibly documents needed from insured.',
 '{
   "claim_ref": {"type": "string", "required": true, "hint": "NISLA claim ID"},
   "visit_date": {"type": "date", "required": true},
   "cause_of_loss": {"type": "string", "required": true},
   "observations": {"type": "string", "required": true, "hint": "key findings"},
   "further_docs_needed": {"type": "string", "required": false}
 }'::jsonb,
 '[
   {"action_type": "update_claim_status", "params": {"status": "site_done"}},
   {"action_type": "file_to_claim_folder", "params": {"category": "preliminary_observations"}},
   {"action_type": "generate_summary", "params": {"format": "markdown"}}
 ]'::jsonb,
 0.88),

('insurer_query', 'Insurer Query', 'QRY', 'Clarification request from insurer', 'amber',
 'Insurer is asking for clarification or additional information on an existing claim. Subject often references a claim number.',
 '{
   "claim_ref": {"type": "string", "required": true},
   "query_type": {"type": "string", "required": true, "hint": "what is being asked"},
   "requested_info": {"type": "string", "required": true},
   "response_deadline": {"type": "string", "required": false}
 }'::jsonb,
 '[
   {"action_type": "link_to_claim", "params": {}},
   {"action_type": "draft_reply", "params": {"context_source": "claim_file"}},
   {"action_type": "set_claim_flag", "params": {"flag": "awaiting_response"}}
 ]'::jsonb,
 0.88),

('settlement_advice', 'Settlement Advice', 'SET', 'Insurer confirms settlement amount', 'emerald',
 'Insurer confirming claim has been settled. Will mention settled amount, settlement date, mode of payment, and any deductions.',
 '{
   "claim_ref": {"type": "string", "required": true},
   "settled_amount": {"type": "string", "required": true},
   "settlement_date": {"type": "date", "required": true},
   "deductions": {"type": "string", "required": false},
   "mode_of_payment": {"type": "string", "required": false}
 }'::jsonb,
 '[
   {"action_type": "update_claim_settlement", "params": {}},
   {"action_type": "mark_claim_closed", "params": {}},
   {"action_type": "trigger_fee_invoice", "params": {}},
   {"action_type": "archive_email", "params": {}}
 ]'::jsonb,
 0.93),

('client_followup', 'Client Follow-up', 'CLI', 'Client or insured chasing for status', 'teal',
 'The insured or their representative is asking about the status of their claim.',
 '{
   "claim_ref_or_name": {"type": "string", "required": true},
   "query_summary": {"type": "string", "required": true},
   "urgency": {"type": "enum", "required": false, "hint": "low, medium, high"}
 }'::jsonb,
 '[
   {"action_type": "route_to_assigned_surveyor", "params": {}},
   {"action_type": "log_in_crm", "params": {"category": "client_followup"}},
   {"action_type": "draft_reply", "params": {"template": "status_update"}}
 ]'::jsonb,
 0.85),

('policy_doc', 'Policy Document', 'POL', 'Policy document received as attachment', 'sky',
 'A policy copy is being shared, usually as a PDF attachment. Often arrives shortly after intimation.',
 '{
   "policy_no": {"type": "string", "required": true},
   "insurer": {"type": "string", "required": true},
   "insured": {"type": "string", "required": true},
   "sum_insured": {"type": "string", "required": false},
   "policy_period": {"type": "string", "required": false},
   "lob": {"type": "string", "required": false}
 }'::jsonb,
 '[
   {"action_type": "archive_pdf_to_claim_folder", "params": {}},
   {"action_type": "extract_policy_fields_to_db", "params": {}},
   {"action_type": "cross_link_to_intimation", "params": {}}
 ]'::jsonb,
 0.88),

('internal_admin', 'Internal / Admin', 'ADM', 'Internal team or admin matters — no extraction', 'slate',
 'Internal team communication, holiday notices, admin matters. No structured data extraction needed.',
 '{}'::jsonb,
 '[
   {"action_type": "file_under_internal", "params": {}}
 ]'::jsonb,
 0.85);

COMMIT;

-- ============================================================================
-- POST-MIGRATION NOTES
-- ============================================================================
-- 1. After running this migration, configure the worker with:
--      - Gmail OAuth tokens (stored in Supabase secrets, not in this DB)
--      - WhatsApp Business API credentials
--      - Anthropic API key
-- 2. Run the worker as a cron job (Vercel cron, Supabase cron, or systemd timer)
--    polling Gmail every 2-5 minutes and consuming WhatsApp webhooks.
-- 3. The classifier output is written via service_role; the UI reads via
--    authenticated role through the v_inbox_with_classification view.
-- 4. Consider adding a 'classification_audit' table later if you need to track
--    every override decision for ML retraining.
-- ============================================================================

-- ============================================================
-- Comms Intelligence — Migration 2: Core Tables
-- SAFE: Purely additive. Idempotent. Re-runnable.
-- ============================================================
-- Creates the 8 core tables for the Communications Intelligence
-- module. All new; no existing tables are touched. RLS is NOT
-- enabled because the portal does not use Supabase Auth
-- sessions; all access goes through Next.js API routes using
-- the service-role client with app-level session checks.
--
-- Key adaptations vs the reference spec:
--   - company TEXT NOT NULL on inbox_messages, classifications,
--     routing_actions (tenant scoping for NISLA vs Acuere)
--   - routing_actions.destination_id is TEXT (polymorphic — can
--     hold BIGINT claim ids as text or UUID comms ids)
--   - No RLS policies (service-role only writes; reads are
--     guarded at the API-route layer)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- tag_definitions — configurable tag library
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tag_definitions (
  id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tag                   workflow_tag NOT NULL UNIQUE,
  display_label         text         NOT NULL,
  short_code            text         NOT NULL,
  description           text         NOT NULL,
  ui_color              text         NOT NULL DEFAULT 'slate',
  classifier_prompt     text         NOT NULL,
  extraction_schema     jsonb        NOT NULL DEFAULT '{}'::jsonb,
  routing_actions       jsonb        NOT NULL DEFAULT '[]'::jsonb,
  auto_route_threshold  numeric(3,2) NOT NULL DEFAULT 0.90,
  enabled               boolean      NOT NULL DEFAULT true,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- inbox_messages — raw incoming emails / WA messages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inbox_messages (
  id                 uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  source             message_source NOT NULL,
  source_msg_id      text           NOT NULL,
  thread_id          text,
  from_address       text           NOT NULL,
  from_display       text,
  to_address         text,
  cc_addresses       text[]         DEFAULT ARRAY[]::text[],
  subject            text,
  body_plain         text           NOT NULL DEFAULT '',
  body_html          text,
  received_at        timestamptz    NOT NULL,
  raw_headers        jsonb,
  attachments_count  integer        NOT NULL DEFAULT 0,
  status             message_status NOT NULL DEFAULT 'received',
  company            text           NOT NULL,
  mailbox_user_email text,
  ingested_at        timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT inbox_messages_unique_per_source UNIQUE (source, source_msg_id)
);

CREATE INDEX IF NOT EXISTS inbox_messages_received_at_idx
  ON inbox_messages (received_at DESC);

CREATE INDEX IF NOT EXISTS inbox_messages_status_idx
  ON inbox_messages (status)
  WHERE status IN ('received', 'pending_review');

CREATE INDEX IF NOT EXISTS inbox_messages_thread_idx
  ON inbox_messages (thread_id)
  WHERE thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inbox_messages_from_idx
  ON inbox_messages (from_address);

CREATE INDEX IF NOT EXISTS inbox_messages_company_idx
  ON inbox_messages (company);

CREATE INDEX IF NOT EXISTS inbox_messages_body_fts
  ON inbox_messages
  USING gin (to_tsvector('english', coalesce(subject, '') || ' ' || body_plain));

-- ------------------------------------------------------------
-- message_attachments — files extracted from messages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_attachments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    uuid        NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
  filename      text        NOT NULL,
  mime_type     text        NOT NULL,
  size_bytes    bigint      NOT NULL,
  storage_path  text        NOT NULL,
  sha256_hash   text        NOT NULL,
  is_image      boolean     NOT NULL DEFAULT false,
  exif_json     jsonb,
  ocr_text      text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_attachments_message_idx
  ON message_attachments (message_id);

CREATE INDEX IF NOT EXISTS message_attachments_hash_idx
  ON message_attachments (sha256_hash);

-- ------------------------------------------------------------
-- message_classifications — classifier output (historied)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_classifications (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       uuid         NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
  tag              workflow_tag NOT NULL,
  confidence       numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  classifier_model text         NOT NULL,
  reasoning        text,
  classified_at    timestamptz  NOT NULL DEFAULT now(),
  classified_by    text         NOT NULL DEFAULT 'auto',
  is_active        boolean      NOT NULL DEFAULT true,
  override_reason  text,
  company          text         NOT NULL
);

CREATE INDEX IF NOT EXISTS message_classifications_message_idx
  ON message_classifications (message_id, is_active);

CREATE INDEX IF NOT EXISTS message_classifications_tag_idx
  ON message_classifications (tag);

-- Trigger function: only one active classification per message
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

DROP TRIGGER IF EXISTS trg_single_active_classification ON message_classifications;
CREATE TRIGGER trg_single_active_classification
  AFTER INSERT OR UPDATE ON message_classifications
  FOR EACH ROW EXECUTE FUNCTION ensure_single_active_classification();

-- ------------------------------------------------------------
-- extraction_results — structured LLM output per classification
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS extraction_results (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id         uuid         NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
  classification_id  uuid         NOT NULL REFERENCES message_classifications(id) ON DELETE CASCADE,
  tag                workflow_tag NOT NULL,
  extracted_data     jsonb        NOT NULL DEFAULT '{}'::jsonb,
  validation_errors  jsonb        NOT NULL DEFAULT '[]'::jsonb,
  is_valid           boolean      NOT NULL DEFAULT true,
  edited_by_user     boolean      NOT NULL DEFAULT false,
  edited_at          timestamptz,
  edited_by          text,
  created_at         timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS extraction_results_message_idx
  ON extraction_results (message_id);

CREATE INDEX IF NOT EXISTS extraction_results_data_gin
  ON extraction_results
  USING gin (extracted_data);

-- ------------------------------------------------------------
-- routing_actions — what we did (or propose to do) per message
-- destination_id is TEXT so it can hold either BIGINT claim ids
-- or UUID ids from comms tables — polymorphic reference.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routing_actions (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id         uuid          NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
  classification_id  uuid          NOT NULL REFERENCES message_classifications(id) ON DELETE CASCADE,
  action_type        text          NOT NULL,
  action_params      jsonb         NOT NULL DEFAULT '{}'::jsonb,
  destination_table  text,
  destination_id     text,
  status             action_status NOT NULL DEFAULT 'pending',
  attempted_at       timestamptz,
  completed_at       timestamptz,
  error_message      text,
  retry_count        integer       NOT NULL DEFAULT 0,
  company            text          NOT NULL,
  created_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS routing_actions_message_idx
  ON routing_actions (message_id);

CREATE INDEX IF NOT EXISTS routing_actions_status_idx
  ON routing_actions (status)
  WHERE status IN ('pending', 'in_progress', 'failed');

CREATE INDEX IF NOT EXISTS routing_actions_destination_idx
  ON routing_actions (destination_table, destination_id);

-- ------------------------------------------------------------
-- whatsapp_contacts — known WA senders (populated in Week 4)
-- Created here so Week 1/2 migrations are complete; Week 4
-- extends with party_type / external_id / company columns.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number    text        NOT NULL UNIQUE,
  display_name    text,
  contact_type    text        NOT NULL DEFAULT 'unknown',
  linked_user_id  uuid,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_contacts_type_idx
  ON whatsapp_contacts (contact_type);

-- ------------------------------------------------------------
-- ingestion_runs — one row per poll/webhook cycle for monitoring
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_runs (
  id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  source            message_source NOT NULL,
  started_at        timestamptz    NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  messages_fetched  integer        NOT NULL DEFAULT 0,
  messages_new      integer        NOT NULL DEFAULT 0,
  messages_failed   integer        NOT NULL DEFAULT 0,
  error_message     text,
  cursor_after      text,
  mailbox_user_email text,
  company           text
);

CREATE INDEX IF NOT EXISTS ingestion_runs_source_started_idx
  ON ingestion_runs (source, started_at DESC);

-- ------------------------------------------------------------
-- updated_at maintenance trigger function (shared)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION comms_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tag_definitions_updated ON tag_definitions;
CREATE TRIGGER trg_tag_definitions_updated
  BEFORE UPDATE ON tag_definitions
  FOR EACH ROW EXECUTE FUNCTION comms_set_updated_at();

DROP TRIGGER IF EXISTS trg_whatsapp_contacts_updated ON whatsapp_contacts;
CREATE TRIGGER trg_whatsapp_contacts_updated
  BEFORE UPDATE ON whatsapp_contacts
  FOR EACH ROW EXECUTE FUNCTION comms_set_updated_at();

COMMIT;

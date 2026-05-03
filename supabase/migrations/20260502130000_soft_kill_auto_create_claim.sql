-- Soft-kill switch for auto-create-claim from intimation emails.
-- Fourth toggle on comms_config alongside ingestion_paused, classification_paused, execution_paused.

ALTER TABLE public.comms_config
  ADD COLUMN IF NOT EXISTS auto_create_claim_paused boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS auto_create_claim_paused_at timestamp with time zone;

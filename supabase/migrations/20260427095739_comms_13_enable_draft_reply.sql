-- ============================================================
-- migration_comms_13_enable_draft_reply.sql
-- Enable AI draft replies for the tags where it's most useful.
--
-- We add 'draft_reply' to the routing_actions of:
--   - client_followup   (clients chasing their claim)
--   - insurer_query     (insurers asking for info / docs)
--   - consent_email     (acknowledge receipt of consent)
--   - intimation        (acknowledge new intimation)
--
-- The executor only runs draft_reply when the message has a
-- from_address; idempotent (skips if a draft already exists).
-- ============================================================

UPDATE tag_definitions
SET routing_actions = (
  CASE
    WHEN routing_actions ? 'draft_reply' THEN routing_actions
    ELSE routing_actions || '["draft_reply"]'::jsonb
  END
)
WHERE tag IN ('client_followup', 'insurer_query', 'consent_email', 'intimation');

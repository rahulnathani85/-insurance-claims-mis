-- =============================================================================
-- disable_auto_routing.sql
-- =============================================================================
-- Per user direction (29 Apr 2026): pause auto-routing on all non-intimation
-- tags. The auto-routing concept is confusing while several action handlers
-- (assign_surveyor, send_email, notify_whatsapp, etc.) are still stubs.
--
-- For intimation specifically: keep ONLY create_claim. The flow is:
--   email tagged "intimation" -> claim shell created (phase=intimation)
--                             -> ready for clerk to register
--
-- Drop assign_surveyor / send_email / notify_whatsapp / draft_reply on
-- intimation: they were either stubs (3 of 4) or a noisy auto-action that
-- doesn't fit the simple intimation flow (draft_reply auto-generated AI
-- drafts even when the user just wanted to triage the email).
--
-- Categorisation continues to work for ALL tags. We only stop the
-- *automatic actions* triggered after categorisation. Clerks can still
-- manually act on tagged messages.
--
-- This is intended to be reversible: the original routing_actions config
-- is preserved in this commit's git history.
-- =============================================================================

BEGIN;

-- 1. Intimation: only create_claim
UPDATE tag_definitions
SET routing_actions = '[{"action_type": "create_claim", "params": {"status": "intimated"}}]'::jsonb
WHERE tag = 'intimation';

-- 2. All other tags: empty (paused)
UPDATE tag_definitions
SET routing_actions = '[]'::jsonb
WHERE tag <> 'intimation';

-- Verify
SELECT tag, jsonb_array_length(routing_actions) AS action_count, routing_actions
FROM tag_definitions
ORDER BY tag;

COMMIT;

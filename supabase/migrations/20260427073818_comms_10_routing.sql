-- ============================================================
-- migration_comms_10_routing.sql
-- Stage 5: Auto-routing — link messages to claims + track actions
--
-- NOTE: claims.id is BIGINT (not UUID), so claim_id columns here
-- are BIGINT to match the FK type.
-- ============================================================

-- 1. Link a routed message to the claim it was matched/created against
ALTER TABLE inbox_messages
  ADD COLUMN IF NOT EXISTS claim_id BIGINT REFERENCES claims(id);

CREATE INDEX IF NOT EXISTS idx_inbox_messages_claim_id ON inbox_messages(claim_id);

-- 2. Track each routing action that was executed for a message
CREATE TABLE IF NOT EXISTS routing_executions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     UUID NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
  action_type    TEXT NOT NULL,
  claim_id       BIGINT REFERENCES claims(id),
  payload        JSONB,
  status         TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'skipped')),
  error          TEXT,
  executed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routing_executions_message_id ON routing_executions(message_id);
CREATE INDEX IF NOT EXISTS idx_routing_executions_claim_id   ON routing_executions(claim_id);
CREATE INDEX IF NOT EXISTS idx_routing_executions_executed_at ON routing_executions(executed_at DESC);

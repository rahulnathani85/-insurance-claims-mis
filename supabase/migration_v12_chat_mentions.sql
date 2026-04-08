-- Migration v12: Chat @mention tagging and unread notifications
-- Run this in Supabase SQL Editor

-- 1. Add mentioned_users column to claim_messages (JSON array of tagged user emails)
ALTER TABLE claim_messages ADD COLUMN IF NOT EXISTS mentioned_users TEXT DEFAULT '[]';

-- 2. Create message_reads table for tracking per-user read status
CREATE TABLE IF NOT EXISTS message_reads (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES claim_messages(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_email)
);

-- 3. Indexes for fast unread mention queries
CREATE INDEX IF NOT EXISTS idx_claim_messages_mentions ON claim_messages USING GIN (to_tsvector('simple', mentioned_users));
CREATE INDEX IF NOT EXISTS idx_message_reads_user ON message_reads(user_email);
CREATE INDEX IF NOT EXISTS idx_message_reads_message ON message_reads(message_id);

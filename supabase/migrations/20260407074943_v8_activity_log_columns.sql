-- Migration V8: Add missing columns to activity_log
-- SAFE: Purely additive. No existing data modified.
-- Run this in Supabase SQL Editor.

-- Add user_name column for readable display
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS user_name TEXT;

-- Add claim_id for direct claim reference filtering
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS claim_id BIGINT;

-- Add ref_number for quick lookup
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS ref_number TEXT;

-- Index for claim-based activity lookup
CREATE INDEX IF NOT EXISTS idx_activity_log_claim ON activity_log(claim_id);

-- Migration v13: Global Chat Messages
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS global_chat_messages (
    id BIGSERIAL PRIMARY KEY,
    sender_email TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    message TEXT NOT NULL,
    mentioned_users TEXT DEFAULT '[]',
    tagged_ref_numbers TEXT DEFAULT '[]',
    company TEXT DEFAULT 'NISLA',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS global_chat_reads (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES global_chat_messages(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    read_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(message_id, user_email)
);

CREATE INDEX IF NOT EXISTS idx_global_chat_company ON global_chat_messages(company);
CREATE INDEX IF NOT EXISTS idx_global_chat_created ON global_chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_global_chat_mentions ON global_chat_messages USING GIN (to_tsvector('simple', mentioned_users));
CREATE INDEX IF NOT EXISTS idx_global_chat_reads_user ON global_chat_reads(user_email);
CREATE INDEX IF NOT EXISTS idx_global_chat_reads_message ON global_chat_reads(message_id);

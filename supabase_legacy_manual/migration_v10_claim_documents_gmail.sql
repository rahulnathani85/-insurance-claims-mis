-- Migration V10: Claim Documents & Gmail Integration
-- Run this in Supabase SQL Editor

-- 1. Table to track all documents uploaded per claim
CREATE TABLE IF NOT EXISTS claim_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id UUID REFERENCES claims(id) ON DELETE CASCADE,
  ref_number TEXT,
  file_name TEXT NOT NULL,
  file_type TEXT, -- 'intimation_sheet', 'lor', 'ila', 'email_attachment', 'survey_report', 'other'
  file_size BIGINT,
  storage_path TEXT NOT NULL, -- Supabase Storage path
  mime_type TEXT,
  uploaded_by TEXT,
  source TEXT DEFAULT 'upload', -- 'upload', 'gmail', 'generated'
  gmail_message_id TEXT, -- if sourced from Gmail
  gmail_subject TEXT, -- email subject if from Gmail
  gmail_from TEXT, -- sender if from Gmail
  gmail_date TIMESTAMPTZ, -- email date if from Gmail
  company TEXT DEFAULT 'NISLA',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Table to store Gmail OAuth tokens per user
CREATE TABLE IF NOT EXISTS gmail_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email TEXT NOT NULL UNIQUE,
  access_token TEXT,
  refresh_token TEXT,
  token_expiry TIMESTAMPTZ,
  gmail_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Table to track emails tagged to claims
CREATE TABLE IF NOT EXISTS claim_emails (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id UUID REFERENCES claims(id) ON DELETE CASCADE,
  ref_number TEXT,
  gmail_message_id TEXT NOT NULL,
  gmail_thread_id TEXT,
  subject TEXT,
  sender TEXT,
  recipients TEXT,
  email_date TIMESTAMPTZ,
  snippet TEXT,
  has_attachments BOOLEAN DEFAULT FALSE,
  tagged_by TEXT,
  company TEXT DEFAULT 'NISLA',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create Supabase Storage bucket for claim documents (run manually in Supabase Dashboard > Storage)
-- Bucket name: claim-documents
-- Public: No (private bucket)

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_claim_documents_claim_id ON claim_documents(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_emails_claim_id ON claim_emails(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_documents_ref ON claim_documents(ref_number);

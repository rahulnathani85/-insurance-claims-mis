-- =============================================================================
-- Backfill migration: legacy columns from OLD prod schema
-- =============================================================================
-- During the OLD->NEW data migration on 29 Apr 2026 we discovered OLD prod had
-- columns that were never in any migration file:
--
--   claims:
--     appointing_office, appointing_type, claim_file_no, estimated_loss_amount,
--     insured_address, insurer_address, person_contacted, surveyor_name
--   inbox_messages:
--     retry_count
--   policy_types:
--     description
--
-- These were added manually outside of any tracked migration. To preserve the
-- data on import (and to keep fresh deployments faithful to OLD), this
-- migration adds them.
--
-- All columns are nullable / have safe defaults so existing rows are unaffected.
-- =============================================================================

-- claims (8 columns)
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS appointing_office       TEXT;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS appointing_type         TEXT;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS claim_file_no           TEXT;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS estimated_loss_amount   NUMERIC;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS insured_address         TEXT;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS insurer_address         TEXT;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS person_contacted        TEXT;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS surveyor_name           TEXT;

-- inbox_messages (1 column)
ALTER TABLE public.inbox_messages ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- policy_types (1 column)
ALTER TABLE public.policy_types  ADD COLUMN IF NOT EXISTS description TEXT;

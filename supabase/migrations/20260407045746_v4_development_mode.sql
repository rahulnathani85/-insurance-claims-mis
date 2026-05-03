-- Migration V4: Add Development Mode profile
-- This migration adds a 'Development' entry to the bill_counters table
-- so that survey fee bills can be generated under the Development company.
--
-- SAFE: This is purely additive. No existing tables or data are modified.
-- Run this once in the Supabase SQL Editor.

-- Add Development bill counter (starts at 0)
INSERT INTO bill_counters (company, counter_value)
VALUES ('Development', 0)
ON CONFLICT (company) DO NOTHING;

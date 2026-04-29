-- Insurance Claims MIS - Supabase Schema
-- Run this in the Supabase SQL Editor to set up all tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Insurers table
CREATE TABLE IF NOT EXISTS insurers (
    id BIGSERIAL PRIMARY KEY,
    code TEXT,
    company_name TEXT NOT NULL,
    registered_address TEXT,
    city TEXT,
    state TEXT,
    pin TEXT,
    phone TEXT,
    email TEXT,
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insurer offices table
CREATE TABLE IF NOT EXISTS insurer_offices (
    id BIGSERIAL PRIMARY KEY,
    insurer_id BIGINT REFERENCES insurers(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Policy types table
CREATE TABLE IF NOT EXISTS policy_types (
    id BIGSERIAL PRIMARY KEY,
    lob TEXT NOT NULL,
    policy_type TEXT NOT NULL,
    UNIQUE(lob, policy_type)
);

-- Policies table
CREATE TABLE IF NOT EXISTS policies (
    id BIGSERIAL PRIMARY KEY,
    policy_number TEXT NOT NULL UNIQUE,
    insurer TEXT,
    insured_name TEXT,
    insured_address TEXT,
    city TEXT,
    phone TEXT,
    email TEXT,
    lob TEXT,
    policy_type TEXT,
    sum_insured TEXT,
    premium TEXT,
    start_date TEXT,
    end_date TEXT,
    policy_copy_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Claims table
CREATE TABLE IF NOT EXISTS claims (
    id BIGSERIAL PRIMARY KEY,
    lob TEXT NOT NULL,
    ref_number TEXT NOT NULL UNIQUE,
    policy_number TEXT,
    insurer_name TEXT,
    claim_number TEXT,
    appointing_insurer TEXT,
    policy_type TEXT,
    date_intimation TEXT,
    date_loss TEXT,
    insured_name TEXT,
    loss_location TEXT,
    gross_loss NUMERIC,
    assessed_loss NUMERIC,
    date_survey TEXT,
    place_survey TEXT,
    date_lor TEXT,
    date_fsr TEXT,
    date_submission TEXT,
    status TEXT DEFAULT 'Open',
    remark TEXT,
    client_category TEXT,
    vessel_name TEXT,
    consignor TEXT,
    consignee TEXT,
    chassis_number TEXT,
    model_spec TEXT,
    dealer_name TEXT,
    lot_number TEXT,
    md_ref_number TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reference counters table
CREATE TABLE IF NOT EXISTS ref_counters (
    id BIGSERIAL PRIMARY KEY,
    lob TEXT NOT NULL UNIQUE,
    counter_value INTEGER DEFAULT 0
);

-- Marine counters table
CREATE TABLE IF NOT EXISTS marine_counters (
    id BIGSERIAL PRIMARY KEY,
    client_category TEXT NOT NULL UNIQUE,
    counter_value INTEGER DEFAULT 0
);

-- Document types table
CREATE TABLE IF NOT EXISTS doc_types (
    id BIGSERIAL PRIMARY KEY,
    lob TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    UNIQUE(lob, doc_type)
);

-- Create storage bucket for documents
-- (Do this in Supabase Dashboard > Storage > New Bucket > "documents" > Public)

-- ============ SEED DATA ============

-- Seed reference counters
INSERT INTO ref_counters (lob, counter_value) VALUES
('Fire', 3000), ('Engineering', 3000), ('Extended Warranty', 0),
('Business Interruption', 3000), ('Miscellaneous', 3000), ('Banking', 0),
('Liability', 3000), ('Marine Hull', 3000), ('Cat Event', 5000), ('Marine Cargo', 0)
ON CONFLICT (lob) DO NOTHING;

-- Seed marine counters
INSERT INTO marine_counters (client_category, counter_value) VALUES
('Tata Motors', 0), ('Grasim', 0), ('Nerolac', 0), ('Tiles', 0),
('Aditya Birla Fashion', 0), ('Others Domestic', 0), ('Others Import', 0)
ON CONFLICT (client_category) DO NOTHING;

-- Seed policy types
INSERT INTO policy_types (lob, policy_type) VALUES
('Fire', 'SFSP'), ('Fire', 'Laghu'), ('Fire', 'Sookshma'), ('Fire', 'IAR'),
('Fire', 'Mega Risk'), ('Fire', 'Declaration'), ('Fire', 'Griha Raksha'),
('Engineering', 'CAR'), ('Engineering', 'EAR'), ('Engineering', 'Electronic Equipment'), ('Engineering', 'CPM'),
('Extended Warranty', 'Vehicle'), ('Extended Warranty', 'Equipment'), ('Extended Warranty', 'Others'),
('Miscellaneous', 'Burglary'), ('Miscellaneous', 'Money'), ('Miscellaneous', 'Jewellers Block'),
('Miscellaneous', 'Banker''s Indemnity'), ('Miscellaneous', 'All Risk'), ('Miscellaneous', 'Stock Broker Indemnity'),
('Banking', 'Credit Card'), ('Banking', 'UPI'), ('Banking', 'Debit Card'), ('Banking', 'Others'),
('Liability', 'Product Recall'), ('Liability', 'CGL'), ('Liability', 'Professional Indemnity'),
('Liability', 'D&O'), ('Liability', 'Cyber Liability'), ('Liability', 'Public Liability'),
('Marine Hull', 'Hull & Machinery'), ('Marine Hull', 'P&I'), ('Marine Hull', 'Loss of Hire'),
('Marine Hull', 'Freight Demurrage'), ('Marine Hull', 'War Risk'),
('Cat Event', 'SFSP'), ('Cat Event', 'Laghu'), ('Cat Event', 'Sookshma'), ('Cat Event', 'IAR'),
('Cat Event', 'Mega Risk'), ('Cat Event', 'Declaration'), ('Cat Event', 'Griha Raksha')
ON CONFLICT (lob, policy_type) DO NOTHING;

-- Seed 28 Indian general insurance companies
INSERT INTO insurers (code, company_name, city, status) VALUES
('NIAC', 'The New India Assurance Co. Ltd.', 'Mumbai', 'Active'),
('UIIC', 'United India Insurance Co. Ltd.', 'Chennai', 'Active'),
('OICL', 'The Oriental Insurance Co. Ltd.', 'New Delhi', 'Active'),
('NICL', 'National Insurance Co. Ltd.', 'Kolkata', 'Active'),
('ICICI', 'ICICI Lombard General Insurance Co. Ltd.', 'Mumbai', 'Active'),
('HDFC', 'HDFC ERGO General Insurance Co. Ltd.', 'Mumbai', 'Active'),
('BAJAJ', 'Bajaj Allianz General Insurance Co. Ltd.', 'Pune', 'Active'),
('TATA', 'Tata AIG General Insurance Co. Ltd.', 'Mumbai', 'Active'),
('SBI', 'SBI General Insurance Co. Ltd.', 'Mumbai', 'Active'),
('RELI', 'Reliance General Insurance Co. Ltd.', 'Mumbai', 'Active'),
('IFFCO', 'IFFCO Tokio General Insurance Co. Ltd.', 'Gurugram', 'Active'),
('CHOL', 'Cholamandalam MS General Insurance Co. Ltd.', 'Chennai', 'Active'),
('FUTU', 'Future Generali India Insurance Co. Ltd.', 'Mumbai', 'Active'),
('STAR', 'Star Health & Allied Insurance Co. Ltd.', 'Chennai', 'Active'),
('ROYAL', 'Royal Sundaram General Insurance Co. Ltd.', 'Chennai', 'Active'),
('MAGMA', 'Magma HDI General Insurance Co. Ltd.', 'Kolkata', 'Active'),
('NAVI', 'Navi General Insurance Ltd.', 'Bengaluru', 'Active'),
('ACKO', 'Acko General Insurance Ltd.', 'Mumbai', 'Active'),
('GODIG', 'Go Digit General Insurance Ltd.', 'Bengaluru', 'Active'),
('LIBER', 'Liberty General Insurance Ltd.', 'Mumbai', 'Active'),
('KOTAK', 'Kotak Mahindra General Insurance Co. Ltd.', 'Mumbai', 'Active'),
('RAHEJ', 'Raheja QBE General Insurance Co. Ltd.', 'Mumbai', 'Active'),
('SHRIR', 'Shriram General Insurance Co. Ltd.', 'Jaipur', 'Active'),
('UNIVE', 'Universal Sompo General Insurance Co. Ltd.', 'Mumbai', 'Active'),
('ZURIC', 'Zurich Kotak General Insurance Co. Ltd.', 'Mumbai', 'Active'),
('ECGC', 'ECGC Ltd.', 'Mumbai', 'Active'),
('AIC', 'Agriculture Insurance Co. of India Ltd.', 'New Delhi', 'Active'),
('GIC', 'GIC Re (General Insurance Corporation of India)', 'Mumbai', 'Active')
ON CONFLICT DO NOTHING;

-- Seed offices for major insurers (RO and LCBO)
DO $$
DECLARE
    ins_id BIGINT;
BEGIN
    -- New India Assurance offices
    SELECT id INTO ins_id FROM insurers WHERE code = 'NIAC' LIMIT 1;
    IF ins_id IS NOT NULL THEN
        INSERT INTO insurer_offices (insurer_id, type, name, city) VALUES
        (ins_id, 'RO', 'Mumbai Regional Office', 'Mumbai'),
        (ins_id, 'RO', 'Delhi Regional Office', 'New Delhi'),
        (ins_id, 'LCBO', 'Mumbai LCBO', 'Mumbai')
        ON CONFLICT DO NOTHING;
    END IF;

    -- United India offices
    SELECT id INTO ins_id FROM insurers WHERE code = 'UIIC' LIMIT 1;
    IF ins_id IS NOT NULL THEN
        INSERT INTO insurer_offices (insurer_id, type, name, city) VALUES
        (ins_id, 'RO', 'Chennai Regional Office', 'Chennai'),
        (ins_id, 'RO', 'Mumbai Regional Office', 'Mumbai'),
        (ins_id, 'LCBO', 'Chennai LCBO', 'Chennai')
        ON CONFLICT DO NOTHING;
    END IF;

    -- ICICI Lombard offices
    SELECT id INTO ins_id FROM insurers WHERE code = 'ICICI' LIMIT 1;
    IF ins_id IS NOT NULL THEN
        INSERT INTO insurer_offices (insurer_id, type, name, city) VALUES
        (ins_id, 'RO', 'Mumbai Regional Office', 'Mumbai'),
        (ins_id, 'RO', 'Delhi Regional Office', 'New Delhi'),
        (ins_id, 'LCBO', 'Mumbai LCBO', 'Mumbai')
        ON CONFLICT DO NOTHING;
    END IF;

    -- HDFC ERGO offices
    SELECT id INTO ins_id FROM insurers WHERE code = 'HDFC' LIMIT 1;
    IF ins_id IS NOT NULL THEN
        INSERT INTO insurer_offices (insurer_id, type, name, city) VALUES
        (ins_id, 'RO', 'Mumbai Regional Office', 'Mumbai'),
        (ins_id, 'LCBO', 'Mumbai LCBO', 'Mumbai')
        ON CONFLICT DO NOTHING;
    END IF;

    -- Bajaj Allianz offices
    SELECT id INTO ins_id FROM insurers WHERE code = 'BAJAJ' LIMIT 1;
    IF ins_id IS NOT NULL THEN
        INSERT INTO insurer_offices (insurer_id, type, name, city) VALUES
        (ins_id, 'RO', 'Pune Regional Office', 'Pune'),
        (ins_id, 'RO', 'Mumbai Regional Office', 'Mumbai'),
        (ins_id, 'LCBO', 'Pune LCBO', 'Pune')
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- Enable Row Level Security (optional, for public access disable it)
-- ALTER TABLE insurers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE claims ENABLE ROW LEVEL SECURITY;

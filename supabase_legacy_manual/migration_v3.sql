-- Migration V3: Insurer offices revamp, survey fee fields, GIPSA rates, policy folders

-- ============ INSURER OFFICES REVAMP ============
-- Add new columns to insurer_offices for GSTIN and full address
ALTER TABLE insurer_offices ADD COLUMN IF NOT EXISTS gstin TEXT;
ALTER TABLE insurer_offices ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE insurer_offices ADD COLUMN IF NOT EXISTS pin TEXT;
ALTER TABLE insurer_offices ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE insurer_offices ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE insurer_offices ADD COLUMN IF NOT EXISTS contact_person TEXT;

-- Add GSTIN to main insurers table too
ALTER TABLE insurers ADD COLUMN IF NOT EXISTS gstin TEXT;

-- ============ CLAIMS: SURVEY FEE FIELDS ============
ALTER TABLE claims ADD COLUMN IF NOT EXISTS survey_fee_bill_number TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS survey_fee_bill_date TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS survey_fee_bill_amount NUMERIC;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS survey_fee_payment_date TEXT;

-- ============ POLICIES: FOLDER PATH ============
ALTER TABLE policies ADD COLUMN IF NOT EXISTS folder_path TEXT;

-- ============ GIPSA FEE SCHEDULE TABLE ============
CREATE TABLE IF NOT EXISTS gipsa_fee_schedule (
    id BIGSERIAL PRIMARY KEY,
    lob TEXT NOT NULL,
    loss_range_min NUMERIC NOT NULL DEFAULT 0,
    loss_range_max NUMERIC, -- NULL means no upper limit
    fee_percentage NUMERIC, -- percentage of loss amount
    min_fee NUMERIC, -- minimum fee for this slab
    max_fee NUMERIC, -- maximum fee for this slab (cap)
    flat_fee NUMERIC, -- flat fee (if applicable instead of percentage)
    description TEXT,
    is_custom BOOLEAN DEFAULT false,
    company TEXT, -- NISLA or Acuere, NULL means applies to both
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============ SURVEY FEE BILLS TABLE ============
CREATE TABLE IF NOT EXISTS survey_fee_bills (
    id BIGSERIAL PRIMARY KEY,
    bill_number TEXT NOT NULL UNIQUE,
    bill_date TEXT NOT NULL,
    claim_id BIGINT REFERENCES claims(id),
    ref_number TEXT,
    lob TEXT,
    insured_name TEXT,
    insurer_name TEXT,
    company TEXT DEFAULT 'NISLA',
    -- Fee calculation details
    loss_amount NUMERIC,
    fee_type TEXT DEFAULT 'GIPSA', -- GIPSA or Custom
    calculated_fee NUMERIC,
    gst_rate NUMERIC DEFAULT 18,
    gst_amount NUMERIC,
    total_amount NUMERIC,
    -- Payment tracking
    payment_status TEXT DEFAULT 'Pending', -- Pending, Paid
    payment_date TEXT,
    payment_reference TEXT,
    -- Additional
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============ BILL COUNTER ============
CREATE TABLE IF NOT EXISTS bill_counters (
    id BIGSERIAL PRIMARY KEY,
    company TEXT NOT NULL UNIQUE,
    counter_value INTEGER DEFAULT 0
);

INSERT INTO bill_counters (company, counter_value) VALUES
('NISLA', 0), ('Acuere', 0)
ON CONFLICT (company) DO NOTHING;

-- ============ SEED GIPSA FEE SCHEDULE ============
-- Standard GIPSA rates for Fire & Allied Perils
INSERT INTO gipsa_fee_schedule (lob, loss_range_min, loss_range_max, fee_percentage, min_fee, max_fee, description) VALUES
('Fire', 0, 100000, NULL, 5000, NULL, 'Up to Rs 1 Lakh - Flat Rs 5,000'),
('Fire', 100001, 500000, 5, NULL, NULL, 'Rs 1-5 Lakh - 5% of loss'),
('Fire', 500001, 1000000, NULL, NULL, NULL, 'Rs 5-10 Lakh - Rs 25,000 + 3% of amount above 5L'),
('Fire', 1000001, 5000000, NULL, NULL, NULL, 'Rs 10-50 Lakh - Rs 40,000 + 2% of amount above 10L'),
('Fire', 5000001, 10000000, NULL, NULL, NULL, 'Rs 50L-1Cr - Rs 1,20,000 + 1.5% above 50L'),
('Fire', 10000001, NULL, NULL, NULL, NULL, 'Above 1 Cr - Rs 1,95,000 + 1% above 1Cr')
ON CONFLICT DO NOTHING;

-- Engineering
INSERT INTO gipsa_fee_schedule (lob, loss_range_min, loss_range_max, fee_percentage, min_fee, max_fee, description) VALUES
('Engineering', 0, 100000, NULL, 5000, NULL, 'Up to Rs 1 Lakh - Flat Rs 5,000'),
('Engineering', 100001, 500000, 5, NULL, NULL, 'Rs 1-5 Lakh - 5% of loss'),
('Engineering', 500001, 1000000, NULL, NULL, NULL, 'Rs 5-10 Lakh - Rs 25,000 + 3% of amount above 5L'),
('Engineering', 1000001, 5000000, NULL, NULL, NULL, 'Rs 10-50 Lakh - Rs 40,000 + 2% of amount above 10L'),
('Engineering', 5000001, 10000000, NULL, NULL, NULL, 'Rs 50L-1Cr - Rs 1,20,000 + 1.5% above 50L'),
('Engineering', 10000001, NULL, NULL, NULL, NULL, 'Above 1 Cr - Rs 1,95,000 + 1% above 1Cr')
ON CONFLICT DO NOTHING;

-- Marine Cargo
INSERT INTO gipsa_fee_schedule (lob, loss_range_min, loss_range_max, fee_percentage, min_fee, max_fee, description) VALUES
('Marine Cargo', 0, 100000, NULL, 3500, NULL, 'Up to Rs 1 Lakh - Flat Rs 3,500'),
('Marine Cargo', 100001, 500000, 4, NULL, NULL, 'Rs 1-5 Lakh - 4% of loss'),
('Marine Cargo', 500001, 1000000, NULL, NULL, NULL, 'Rs 5-10 Lakh - Rs 20,000 + 2.5% above 5L'),
('Marine Cargo', 1000001, 5000000, NULL, NULL, NULL, 'Rs 10-50 Lakh - Rs 32,500 + 1.5% above 10L'),
('Marine Cargo', 5000001, NULL, NULL, NULL, NULL, 'Above 50 Lakh - Rs 92,500 + 1% above 50L')
ON CONFLICT DO NOTHING;

-- Miscellaneous
INSERT INTO gipsa_fee_schedule (lob, loss_range_min, loss_range_max, fee_percentage, min_fee, max_fee, description) VALUES
('Miscellaneous', 0, 100000, NULL, 5000, NULL, 'Up to Rs 1 Lakh - Flat Rs 5,000'),
('Miscellaneous', 100001, 500000, 5, NULL, NULL, 'Rs 1-5 Lakh - 5% of loss'),
('Miscellaneous', 500001, 1000000, NULL, NULL, NULL, 'Rs 5-10 Lakh - Rs 25,000 + 3% above 5L'),
('Miscellaneous', 1000001, 5000000, NULL, NULL, NULL, 'Rs 10-50 Lakh - Rs 40,000 + 2% above 10L'),
('Miscellaneous', 5000001, NULL, NULL, NULL, NULL, 'Above 50 Lakh - Rs 1,20,000 + 1.5% above 50L')
ON CONFLICT DO NOTHING;

-- Business Interruption (same as Fire)
INSERT INTO gipsa_fee_schedule (lob, loss_range_min, loss_range_max, fee_percentage, min_fee, max_fee, description) VALUES
('Business Interruption', 0, 100000, NULL, 5000, NULL, 'Up to Rs 1 Lakh - Flat Rs 5,000'),
('Business Interruption', 100001, 500000, 5, NULL, NULL, 'Rs 1-5 Lakh - 5% of loss'),
('Business Interruption', 500001, 1000000, NULL, NULL, NULL, 'Rs 5-10 Lakh - Rs 25,000 + 3% above 5L'),
('Business Interruption', 1000001, 5000000, NULL, NULL, NULL, 'Rs 10-50 Lakh - Rs 40,000 + 2% above 10L'),
('Business Interruption', 5000001, NULL, NULL, NULL, NULL, 'Above 50 Lakh - Rs 1,20,000 + 1.5% above 50L')
ON CONFLICT DO NOTHING;

-- Extended Warranty
INSERT INTO gipsa_fee_schedule (lob, loss_range_min, loss_range_max, fee_percentage, min_fee, max_fee, description) VALUES
('Extended Warranty', 0, 50000, NULL, 2500, NULL, 'Up to Rs 50K - Flat Rs 2,500'),
('Extended Warranty', 50001, 200000, 4, NULL, NULL, 'Rs 50K-2L - 4% of loss'),
('Extended Warranty', 200001, 500000, NULL, NULL, NULL, 'Rs 2-5 Lakh - Rs 8,000 + 3% above 2L'),
('Extended Warranty', 500001, NULL, NULL, NULL, NULL, 'Above 5 Lakh - Rs 17,000 + 2% above 5L')
ON CONFLICT DO NOTHING;

-- Banking
INSERT INTO gipsa_fee_schedule (lob, loss_range_min, loss_range_max, fee_percentage, min_fee, max_fee, description) VALUES
('Banking', 0, 100000, NULL, 3500, NULL, 'Up to Rs 1 Lakh - Flat Rs 3,500'),
('Banking', 100001, 500000, 4, NULL, NULL, 'Rs 1-5 Lakh - 4% of loss'),
('Banking', 500001, NULL, NULL, NULL, NULL, 'Above 5 Lakh - Rs 20,000 + 2% above 5L')
ON CONFLICT DO NOTHING;

-- Liability
INSERT INTO gipsa_fee_schedule (lob, loss_range_min, loss_range_max, fee_percentage, min_fee, max_fee, description) VALUES
('Liability', 0, 100000, NULL, 5000, NULL, 'Up to Rs 1 Lakh - Flat Rs 5,000'),
('Liability', 100001, 500000, 5, NULL, NULL, 'Rs 1-5 Lakh - 5% of loss'),
('Liability', 500001, 1000000, NULL, NULL, NULL, 'Rs 5-10 Lakh - Rs 25,000 + 3% above 5L'),
('Liability', 1000001, NULL, NULL, NULL, NULL, 'Above 10 Lakh - Rs 40,000 + 2% above 10L')
ON CONFLICT DO NOTHING;

-- Marine Hull
INSERT INTO gipsa_fee_schedule (lob, loss_range_min, loss_range_max, fee_percentage, min_fee, max_fee, description) VALUES
('Marine Hull', 0, 100000, NULL, 5000, NULL, 'Up to Rs 1 Lakh - Flat Rs 5,000'),
('Marine Hull', 100001, 500000, 5, NULL, NULL, 'Rs 1-5 Lakh - 5% of loss'),
('Marine Hull', 500001, 1000000, NULL, NULL, NULL, 'Rs 5-10 Lakh - Rs 25,000 + 3% above 5L'),
('Marine Hull', 1000001, NULL, NULL, NULL, NULL, 'Above 10 Lakh - Rs 40,000 + 2% above 10L')
ON CONFLICT DO NOTHING;

-- Cat Event (same as Fire)
INSERT INTO gipsa_fee_schedule (lob, loss_range_min, loss_range_max, fee_percentage, min_fee, max_fee, description) VALUES
('Cat Event', 0, 100000, NULL, 5000, NULL, 'Up to Rs 1 Lakh - Flat Rs 5,000'),
('Cat Event', 100001, 500000, 5, NULL, NULL, 'Rs 1-5 Lakh - 5% of loss'),
('Cat Event', 500001, 1000000, NULL, NULL, NULL, 'Rs 5-10 Lakh - Rs 25,000 + 3% above 5L'),
('Cat Event', 1000001, 5000000, NULL, NULL, NULL, 'Rs 10-50 Lakh - Rs 40,000 + 2% above 10L'),
('Cat Event', 5000001, NULL, NULL, NULL, NULL, 'Above 50 Lakh - Rs 1,20,000 + 1.5% above 50L')
ON CONFLICT DO NOTHING;

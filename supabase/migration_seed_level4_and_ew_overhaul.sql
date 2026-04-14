-- ============================================================
-- Migration: Seed Level 4 Subject Matter + EW Overhaul columns
-- DO NOT RUN until approved
-- ============================================================

BEGIN;

-- ============================================================
-- 1. SEED LEVEL 4: Subject Matter of Loss
-- Under Fire > SFSP/Sookshma/Laghu/Griha Raksha/Declaration > Fire Damage
-- ============================================================

-- Helper: Insert subject matters under all "Fire Damage" causes for standard fire policies
INSERT INTO claim_categories (parent_id, name, level, level_label, sort_order)
SELECT c.id, sm.name, 4, 'Subject Matter', sm.sort_order
FROM claim_categories c
JOIN claim_categories pt ON c.parent_id = pt.id AND pt.level = 2
JOIN claim_categories lob ON pt.parent_id = lob.id AND lob.level = 1
CROSS JOIN (VALUES
  ('Stock', 1),
  ('Plant & Machinery', 2),
  ('Building', 3),
  ('Stock & Building', 4),
  ('Furniture & Fixtures', 5),
  ('Electronic Equipment', 6),
  ('Vehicles', 7),
  ('Raw Materials', 8),
  ('Finished Goods', 9),
  ('Others', 99)
) AS sm(name, sort_order)
WHERE c.name IN ('Fire Damage', 'Explosion', 'Storm / Flood', 'Earthquake', 'Impact Damage')
  AND c.level = 3
  AND lob.name IN ('Fire', 'Cat Event')
  AND pt.name IN ('SFSP', 'Sookshma', 'Laghu', 'Griha Raksha', 'Declaration Policy');

-- Subject matters under IAR / Mega Risk > Material Damage
INSERT INTO claim_categories (parent_id, name, level, level_label, sort_order)
SELECT c.id, sm.name, 4, 'Subject Matter', sm.sort_order
FROM claim_categories c
JOIN claim_categories pt ON c.parent_id = pt.id AND pt.level = 2
JOIN claim_categories lob ON pt.parent_id = lob.id AND lob.level = 1
CROSS JOIN (VALUES
  ('Stock', 1),
  ('Plant & Machinery', 2),
  ('Building', 3),
  ('Stock & Building', 4),
  ('Electronic Equipment', 5),
  ('Others', 99)
) AS sm(name, sort_order)
WHERE c.name = 'Material Damage'
  AND c.level = 3
  AND lob.name IN ('Fire', 'Cat Event')
  AND pt.name IN ('IAR', 'Mega Risk');

-- Subject matters under IAR / Mega Risk > Breakdown
INSERT INTO claim_categories (parent_id, name, level, level_label, sort_order)
SELECT c.id, sm.name, 4, 'Subject Matter', sm.sort_order
FROM claim_categories c
JOIN claim_categories pt ON c.parent_id = pt.id AND pt.level = 2
JOIN claim_categories lob ON pt.parent_id = lob.id AND lob.level = 1
CROSS JOIN (VALUES
  ('Machinery', 1),
  ('Boiler', 2),
  ('Electrical Equipment', 3),
  ('Compressor', 4),
  ('Transformer', 5),
  ('Others', 99)
) AS sm(name, sort_order)
WHERE c.name = 'Breakdown'
  AND c.level = 3
  AND lob.name IN ('Fire', 'Cat Event')
  AND pt.name IN ('IAR', 'Mega Risk');

-- ============================================================
-- 2. EW OVERHAUL: Add surveyor + deadline columns
-- ============================================================

-- Surveyor assignment on EW claims
ALTER TABLE ew_vehicle_claims ADD COLUMN IF NOT EXISTS assigned_surveyor text;
ALTER TABLE ew_vehicle_claims ADD COLUMN IF NOT EXISTS assigned_surveyor_name text;

-- Claim-level SLA deadline
ALTER TABLE ew_vehicle_claims ADD COLUMN IF NOT EXISTS sla_due_date date;

-- Per-stage due date
ALTER TABLE ew_claim_stages ADD COLUMN IF NOT EXISTS due_date date;

-- Surveyor assignment on general claims too
ALTER TABLE claims ADD COLUMN IF NOT EXISTS assigned_surveyor text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS assigned_surveyor_name text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS sla_due_date date;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ew_claims_surveyor ON ew_vehicle_claims(assigned_surveyor);
CREATE INDEX IF NOT EXISTS idx_ew_claims_sla ON ew_vehicle_claims(sla_due_date);
CREATE INDEX IF NOT EXISTS idx_ew_stages_due ON ew_claim_stages(due_date);

COMMIT;

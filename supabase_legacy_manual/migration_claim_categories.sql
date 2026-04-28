-- ============================================================
-- Migration: Claim Categories Hierarchy
-- DO NOT RUN until approved by user
-- ============================================================

BEGIN;

-- ============================================================
-- 1. CREATE TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS claim_categories (
  id          bigserial PRIMARY KEY,
  parent_id   bigint REFERENCES claim_categories(id) ON DELETE CASCADE,
  name        text NOT NULL,
  level       int NOT NULL,
  level_label text,
  code        text,
  icon        text,
  color       text,
  sort_order  int DEFAULT 0,
  is_active   boolean DEFAULT true,
  metadata    jsonb DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claim_categories_parent ON claim_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_claim_categories_level ON claim_categories(level);

-- ============================================================
-- 2. SEED LEVEL 1: LOBs (from existing constants.js)
-- ============================================================
INSERT INTO claim_categories (name, level, level_label, code, icon, color, sort_order) VALUES
  ('Fire',                1, 'LOB', 'Fire',      '🔥', '#dc2626', 1),
  ('Cat Event',           1, 'LOB', 'CAT',       '🌪️', '#7c3aed', 2),
  ('Business Interruption',1,'LOB', 'BI',        '📊', '#ea580c', 3),
  ('Banking',             1, 'LOB', 'Banking',   '🏦', '#0d9488', 4),
  ('Miscellaneous',       1, 'LOB', 'Misc',      '📦', '#6366f1', 5),
  ('Engineering',         1, 'LOB', 'Engg',      '⚙️', '#ca8a04', 6),
  ('Marine Cargo',        1, 'LOB', 'Marine',    '⚓', '#0891b2', 7),
  ('Liability',           1, 'LOB', 'Liability', '⚖️', '#be185d', 8),
  ('Marine Hull',         1, 'LOB', 'Hull',      '🚢', '#4f46e5', 9),
  ('Extended Warranty',   1, 'LOB', 'EW',        '🛡️', '#7c3aed', 10);

-- ============================================================
-- 3. SEED LEVEL 2: Policy Types per LOB
-- ============================================================

-- Fire (A)
INSERT INTO claim_categories (parent_id, name, level, level_label, code, sort_order) VALUES
  ((SELECT id FROM claim_categories WHERE name='Fire' AND level=1), 'SFSP',               2, 'Policy Type', 'SFSP', 1),
  ((SELECT id FROM claim_categories WHERE name='Fire' AND level=1), 'Sookshma',           2, 'Policy Type', 'SOOK', 2),
  ((SELECT id FROM claim_categories WHERE name='Fire' AND level=1), 'Laghu',              2, 'Policy Type', 'LAGHU', 3),
  ((SELECT id FROM claim_categories WHERE name='Fire' AND level=1), 'IAR',                2, 'Policy Type', 'IAR', 4),
  ((SELECT id FROM claim_categories WHERE name='Fire' AND level=1), 'Mega Risk',          2, 'Policy Type', 'MEGA', 5),
  ((SELECT id FROM claim_categories WHERE name='Fire' AND level=1), 'Griha Raksha',       2, 'Policy Type', 'GRIHA', 6),
  ((SELECT id FROM claim_categories WHERE name='Fire' AND level=1), 'Declaration Policy', 2, 'Policy Type', 'DECL', 7),
  ((SELECT id FROM claim_categories WHERE name='Fire' AND level=1), 'Others',             2, 'Policy Type', NULL, 99);

-- Cat Event (B) - same policy types as Fire
INSERT INTO claim_categories (parent_id, name, level, level_label, code, sort_order) VALUES
  ((SELECT id FROM claim_categories WHERE name='Cat Event' AND level=1), 'SFSP',               2, 'Policy Type', 'SFSP', 1),
  ((SELECT id FROM claim_categories WHERE name='Cat Event' AND level=1), 'Sookshma',           2, 'Policy Type', 'SOOK', 2),
  ((SELECT id FROM claim_categories WHERE name='Cat Event' AND level=1), 'Laghu',              2, 'Policy Type', 'LAGHU', 3),
  ((SELECT id FROM claim_categories WHERE name='Cat Event' AND level=1), 'IAR',                2, 'Policy Type', 'IAR', 4),
  ((SELECT id FROM claim_categories WHERE name='Cat Event' AND level=1), 'Mega Risk',          2, 'Policy Type', 'MEGA', 5),
  ((SELECT id FROM claim_categories WHERE name='Cat Event' AND level=1), 'Griha Raksha',       2, 'Policy Type', 'GRIHA', 6),
  ((SELECT id FROM claim_categories WHERE name='Cat Event' AND level=1), 'Declaration Policy', 2, 'Policy Type', 'DECL', 7),
  ((SELECT id FROM claim_categories WHERE name='Cat Event' AND level=1), 'Others',             2, 'Policy Type', NULL, 99);

-- Business Interruption (C)
INSERT INTO claim_categories (parent_id, name, level, level_label, code, sort_order) VALUES
  ((SELECT id FROM claim_categories WHERE name='Business Interruption' AND level=1), 'Advance Loss of Profit (ALOP)',          2, 'Policy Type', 'ALOP', 1),
  ((SELECT id FROM claim_categories WHERE name='Business Interruption' AND level=1), 'Contingent Business Interruption',       2, 'Policy Type', 'CBI', 2),
  ((SELECT id FROM claim_categories WHERE name='Business Interruption' AND level=1), 'Machinery Loss of Profit (MLOP)',        2, 'Policy Type', 'MLOP', 3),
  ((SELECT id FROM claim_categories WHERE name='Business Interruption' AND level=1), 'Standard Business Interruption',         2, 'Policy Type', 'SBI', 4),
  ((SELECT id FROM claim_categories WHERE name='Business Interruption' AND level=1), 'Others',                                 2, 'Policy Type', NULL, 99);

-- Banking (D)
INSERT INTO claim_categories (parent_id, name, level, level_label, code, sort_order) VALUES
  ((SELECT id FROM claim_categories WHERE name='Banking' AND level=1), 'Credit Card',  2, 'Policy Type', 'CC', 1),
  ((SELECT id FROM claim_categories WHERE name='Banking' AND level=1), 'Debit Card',   2, 'Policy Type', 'DC', 2),
  ((SELECT id FROM claim_categories WHERE name='Banking' AND level=1), 'UPI',          2, 'Policy Type', 'UPI', 3),
  ((SELECT id FROM claim_categories WHERE name='Banking' AND level=1), 'Others',       2, 'Policy Type', NULL, 99);

-- Miscellaneous (E)
INSERT INTO claim_categories (parent_id, name, level, level_label, code, sort_order) VALUES
  ((SELECT id FROM claim_categories WHERE name='Miscellaneous' AND level=1), 'All Risk',                 2, 'Policy Type', 'AR', 1),
  ((SELECT id FROM claim_categories WHERE name='Miscellaneous' AND level=1), 'Banker''s Indemnity',      2, 'Policy Type', 'BI', 2),
  ((SELECT id FROM claim_categories WHERE name='Miscellaneous' AND level=1), 'Burglary',                 2, 'Policy Type', 'BURG', 3),
  ((SELECT id FROM claim_categories WHERE name='Miscellaneous' AND level=1), 'Jewellers Block',          2, 'Policy Type', 'JB', 4),
  ((SELECT id FROM claim_categories WHERE name='Miscellaneous' AND level=1), 'Money',                    2, 'Policy Type', 'MON', 5),
  ((SELECT id FROM claim_categories WHERE name='Miscellaneous' AND level=1), 'Fidelity Guarantee',       2, 'Policy Type', 'FG', 6),
  ((SELECT id FROM claim_categories WHERE name='Miscellaneous' AND level=1), 'Stock Broker''s Indemnity',2, 'Policy Type', 'SBI', 7),
  ((SELECT id FROM claim_categories WHERE name='Miscellaneous' AND level=1), 'Crop / Livestock',         2, 'Policy Type', 'CROP', 8),
  ((SELECT id FROM claim_categories WHERE name='Miscellaneous' AND level=1), 'Others',                   2, 'Policy Type', NULL, 99);

-- Engineering (F)
INSERT INTO claim_categories (parent_id, name, level, level_label, code, sort_order) VALUES
  ((SELECT id FROM claim_categories WHERE name='Engineering' AND level=1), 'Contractor All Risk (CAR)',           2, 'Policy Type', 'CAR', 1),
  ((SELECT id FROM claim_categories WHERE name='Engineering' AND level=1), 'Erection All Risk (EAR)',             2, 'Policy Type', 'EAR', 2),
  ((SELECT id FROM claim_categories WHERE name='Engineering' AND level=1), 'Machinery Breakdown (MB)',            2, 'Policy Type', 'MB', 3),
  ((SELECT id FROM claim_categories WHERE name='Engineering' AND level=1), 'Boiler Explosion',                    2, 'Policy Type', 'BOILER', 4),
  ((SELECT id FROM claim_categories WHERE name='Engineering' AND level=1), 'Contractor Plant & Machinery (CPM)',  2, 'Policy Type', 'CPM', 5),
  ((SELECT id FROM claim_categories WHERE name='Engineering' AND level=1), 'Electronic Equipment Insurance (EEI)',2, 'Policy Type', 'EEI', 6),
  ((SELECT id FROM claim_categories WHERE name='Engineering' AND level=1), 'Others',                              2, 'Policy Type', NULL, 99);

-- Marine Cargo (G)
INSERT INTO claim_categories (parent_id, name, level, level_label, code, sort_order) VALUES
  ((SELECT id FROM claim_categories WHERE name='Marine Cargo' AND level=1), 'Annual Turnover Policy',   2, 'Policy Type', 'ATP', 1),
  ((SELECT id FROM claim_categories WHERE name='Marine Cargo' AND level=1), 'Declaration Policy',       2, 'Policy Type', 'DECL', 2),
  ((SELECT id FROM claim_categories WHERE name='Marine Cargo' AND level=1), 'Sales Turnover Policy',    2, 'Policy Type', 'STP', 3),
  ((SELECT id FROM claim_categories WHERE name='Marine Cargo' AND level=1), 'Inland Transit Policy',    2, 'Policy Type', 'ITP', 4),
  ((SELECT id FROM claim_categories WHERE name='Marine Cargo' AND level=1), 'Open Policy',              2, 'Policy Type', 'OP', 5),
  ((SELECT id FROM claim_categories WHERE name='Marine Cargo' AND level=1), 'Specific Voyage Policy',   2, 'Policy Type', 'SVP', 6),
  ((SELECT id FROM claim_categories WHERE name='Marine Cargo' AND level=1), 'Others',                   2, 'Policy Type', NULL, 99);

-- Liability (H)
INSERT INTO claim_categories (parent_id, name, level, level_label, code, sort_order) VALUES
  ((SELECT id FROM claim_categories WHERE name='Liability' AND level=1), 'Public Liability',         2, 'Policy Type', 'PL', 1),
  ((SELECT id FROM claim_categories WHERE name='Liability' AND level=1), 'Product Recall',           2, 'Policy Type', 'PR', 2),
  ((SELECT id FROM claim_categories WHERE name='Liability' AND level=1), 'Employer''s Liability',    2, 'Policy Type', 'EL', 3),
  ((SELECT id FROM claim_categories WHERE name='Liability' AND level=1), 'CGL',                      2, 'Policy Type', 'CGL', 4),
  ((SELECT id FROM claim_categories WHERE name='Liability' AND level=1), 'Cyber Liability',          2, 'Policy Type', 'CYBER', 5),
  ((SELECT id FROM claim_categories WHERE name='Liability' AND level=1), 'D&O Liability',            2, 'Policy Type', 'DO', 6),
  ((SELECT id FROM claim_categories WHERE name='Liability' AND level=1), 'Professional Indemnity',   2, 'Policy Type', 'PI', 7),
  ((SELECT id FROM claim_categories WHERE name='Liability' AND level=1), 'Others',                   2, 'Policy Type', NULL, 99);

-- Marine Hull (I)
INSERT INTO claim_categories (parent_id, name, level, level_label, code, sort_order) VALUES
  ((SELECT id FROM claim_categories WHERE name='Marine Hull' AND level=1), 'Freight Demurrage',  2, 'Policy Type', 'FD', 1),
  ((SELECT id FROM claim_categories WHERE name='Marine Hull' AND level=1), 'Hull & Machinery',   2, 'Policy Type', 'HM', 2),
  ((SELECT id FROM claim_categories WHERE name='Marine Hull' AND level=1), 'Loss of Hire',       2, 'Policy Type', 'LOH', 3),
  ((SELECT id FROM claim_categories WHERE name='Marine Hull' AND level=1), 'P&I',                2, 'Policy Type', 'PI', 4),
  ((SELECT id FROM claim_categories WHERE name='Marine Hull' AND level=1), 'War Risk',           2, 'Policy Type', 'WAR', 5),
  ((SELECT id FROM claim_categories WHERE name='Marine Hull' AND level=1), 'Others',             2, 'Policy Type', NULL, 99);

-- Extended Warranty (J)
INSERT INTO claim_categories (parent_id, name, level, level_label, code, sort_order) VALUES
  ((SELECT id FROM claim_categories WHERE name='Extended Warranty' AND level=1), 'Vehicle',    2, 'Policy Type', 'VEH', 1),
  ((SELECT id FROM claim_categories WHERE name='Extended Warranty' AND level=1), 'Equipment',  2, 'Policy Type', 'EQUIP', 2),
  ((SELECT id FROM claim_categories WHERE name='Extended Warranty' AND level=1), 'Others',     2, 'Policy Type', NULL, 99);

-- ============================================================
-- 4. SEED LEVEL 3: Cause/Nature of Loss (for Fire-type policies)
-- ============================================================

-- Fire > SFSP > causes
INSERT INTO claim_categories (parent_id, name, level, level_label, sort_order)
SELECT pt.id, cause.name, 3, 'Cause of Loss', cause.sort_order
FROM claim_categories pt
CROSS JOIN (VALUES
  ('Fire Damage', 1), ('Explosion', 2), ('Storm / Flood', 3),
  ('Earthquake', 4), ('Impact Damage', 5), ('Others', 99)
) AS cause(name, sort_order)
WHERE pt.name = 'SFSP' AND pt.level = 2
  AND pt.parent_id = (SELECT id FROM claim_categories WHERE name='Fire' AND level=1);

-- Fire > Sookshma > causes (same set)
INSERT INTO claim_categories (parent_id, name, level, level_label, sort_order)
SELECT pt.id, cause.name, 3, 'Cause of Loss', cause.sort_order
FROM claim_categories pt
CROSS JOIN (VALUES
  ('Fire Damage', 1), ('Explosion', 2), ('Storm / Flood', 3),
  ('Earthquake', 4), ('Impact Damage', 5), ('Others', 99)
) AS cause(name, sort_order)
WHERE pt.name = 'Sookshma' AND pt.level = 2
  AND pt.parent_id = (SELECT id FROM claim_categories WHERE name='Fire' AND level=1);

-- Fire > Laghu > causes
INSERT INTO claim_categories (parent_id, name, level, level_label, sort_order)
SELECT pt.id, cause.name, 3, 'Cause of Loss', cause.sort_order
FROM claim_categories pt
CROSS JOIN (VALUES
  ('Fire Damage', 1), ('Explosion', 2), ('Storm / Flood', 3),
  ('Earthquake', 4), ('Impact Damage', 5), ('Others', 99)
) AS cause(name, sort_order)
WHERE pt.name = 'Laghu' AND pt.level = 2
  AND pt.parent_id = (SELECT id FROM claim_categories WHERE name='Fire' AND level=1);

-- Fire > IAR > causes
INSERT INTO claim_categories (parent_id, name, level, level_label, sort_order)
SELECT pt.id, cause.name, 3, 'Cause of Loss', cause.sort_order
FROM claim_categories pt
CROSS JOIN (VALUES
  ('Material Damage', 1), ('Breakdown', 2), ('Business Interruption', 3), ('Others', 99)
) AS cause(name, sort_order)
WHERE pt.name = 'IAR' AND pt.level = 2
  AND pt.parent_id = (SELECT id FROM claim_categories WHERE name='Fire' AND level=1);

-- Fire > Mega Risk > causes
INSERT INTO claim_categories (parent_id, name, level, level_label, sort_order)
SELECT pt.id, cause.name, 3, 'Cause of Loss', cause.sort_order
FROM claim_categories pt
CROSS JOIN (VALUES
  ('Material Damage', 1), ('Breakdown', 2), ('Business Interruption', 3), ('Others', 99)
) AS cause(name, sort_order)
WHERE pt.name = 'Mega Risk' AND pt.level = 2
  AND pt.parent_id = (SELECT id FROM claim_categories WHERE name='Fire' AND level=1);

-- Fire > Griha Raksha > causes
INSERT INTO claim_categories (parent_id, name, level, level_label, sort_order)
SELECT pt.id, cause.name, 3, 'Cause of Loss', cause.sort_order
FROM claim_categories pt
CROSS JOIN (VALUES
  ('Fire Damage', 1), ('Explosion', 2), ('Storm / Flood', 3),
  ('Earthquake', 4), ('Impact Damage', 5), ('Others', 99)
) AS cause(name, sort_order)
WHERE pt.name = 'Griha Raksha' AND pt.level = 2
  AND pt.parent_id = (SELECT id FROM claim_categories WHERE name='Fire' AND level=1);

-- Fire > Declaration Policy > causes
INSERT INTO claim_categories (parent_id, name, level, level_label, sort_order)
SELECT pt.id, cause.name, 3, 'Cause of Loss', cause.sort_order
FROM claim_categories pt
CROSS JOIN (VALUES
  ('Fire Damage', 1), ('Explosion', 2), ('Storm / Flood', 3),
  ('Earthquake', 4), ('Impact Damage', 5), ('Others', 99)
) AS cause(name, sort_order)
WHERE pt.name = 'Declaration Policy' AND pt.level = 2
  AND pt.parent_id = (SELECT id FROM claim_categories WHERE name='Fire' AND level=1);

-- ============================================================
-- NOTE: Level 4 (Subject Matter of Loss) like Stock, Building,
-- Plant & Machinery etc. will be added by admin through the UI
-- since they vary per claim context. The admin page makes this easy.
-- ============================================================

-- ============================================================
-- 5. ADD CATEGORY COLUMNS TO CLAIMS TABLE (backward compatible)
-- ============================================================
ALTER TABLE claims ADD COLUMN IF NOT EXISTS lob_category_id bigint REFERENCES claim_categories(id);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS policy_type_category_id bigint REFERENCES claim_categories(id);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS cause_of_loss_id bigint REFERENCES claim_categories(id);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS subject_matter_id bigint REFERENCES claim_categories(id);

CREATE INDEX IF NOT EXISTS idx_claims_lob_category ON claims(lob_category_id);
CREATE INDEX IF NOT EXISTS idx_claims_policy_type_category ON claims(policy_type_category_id);

COMMIT;

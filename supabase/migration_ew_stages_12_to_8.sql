-- ============================================================
-- Migration: Convert existing EW claims from 12-stage to 8-stage
--
-- Mapping:
--   Old 1 (Claim Intimation) + 2 (Claim Registration)     → New 1 (Intimation & Registration)
--   Old 3 (Contact Dealer) + 4 (Initial Inspection)       → New 2 (Initial Inspection Done)
--   Old 5 (Document Analysis) + 6 (Observation Shared)    → New 3 (Observation Shared)
--   Old 7 (Dismantled Inspection)                          → New 4 (Dismantling Inspection)
--   Old 8 (Estimate Approved) + 9 (Reinspection)          → New 5 (Reinspection)
--   Old 10 (Tax Invoice Collected)                         → New 6 (Tax Invoice Receipt)
--   Old 11 (Assessment Done)                               → New 7 (Assessment)
--   Old 12 (FSR Prepared)                                  → New 8 (Final Survey Report)
--
-- Status logic for merged stages:
--   Completed + anything = Completed
--   In Progress + Pending = In Progress
--   Skipped + Pending = Skipped
--   Pending + Pending = Pending
--
-- Takes earliest started_date, latest completed_date, concatenates notes
-- ============================================================

BEGIN;

-- Step 1: Create temporary merged rows (stage_number 101-108 to avoid conflicts)
INSERT INTO ew_claim_stages (ew_claim_id, stage_number, stage_name, status, started_date, completed_date, notes, updated_by, created_at, updated_at)
SELECT
  ew_claim_id,
  new_stage + 100 AS stage_number,  -- temporary offset
  new_name,
  -- Status: best of the two merged stages
  CASE
    WHEN COALESCE(s1_status, 'Pending') = 'Completed' OR COALESCE(s2_status, 'Pending') = 'Completed' THEN 'Completed'
    WHEN COALESCE(s1_status, 'Pending') = 'In Progress' OR COALESCE(s2_status, 'Pending') = 'In Progress' THEN 'In Progress'
    WHEN COALESCE(s1_status, 'Pending') = 'Skipped' OR COALESCE(s2_status, 'Pending') = 'Skipped' THEN 'Skipped'
    ELSE 'Pending'
  END,
  -- Earliest started_date
  LEAST(s1_started, s2_started),
  -- Latest completed_date
  GREATEST(s1_completed, s2_completed),
  -- Concatenate notes
  NULLIF(TRIM(COALESCE(s1_notes, '') || CASE WHEN s1_notes IS NOT NULL AND s2_notes IS NOT NULL THEN ' | ' ELSE '' END || COALESCE(s2_notes, '')), ''),
  -- Updated by from most recent
  COALESCE(s2_updated_by, s1_updated_by),
  NOW(),
  NOW()
FROM (
  -- Build merged pairs for each ew_claim_id
  SELECT
    a.ew_claim_id,
    m.new_stage,
    m.new_name,
    -- First old stage in the pair
    MAX(CASE WHEN a.stage_number = m.old1 THEN a.status END) AS s1_status,
    MAX(CASE WHEN a.stage_number = m.old1 THEN a.started_date END) AS s1_started,
    MAX(CASE WHEN a.stage_number = m.old1 THEN a.completed_date END) AS s1_completed,
    MAX(CASE WHEN a.stage_number = m.old1 THEN a.notes END) AS s1_notes,
    MAX(CASE WHEN a.stage_number = m.old1 THEN a.updated_by END) AS s1_updated_by,
    -- Second old stage in the pair (NULL for unpaired stages)
    MAX(CASE WHEN a.stage_number = m.old2 THEN a.status END) AS s2_status,
    MAX(CASE WHEN a.stage_number = m.old2 THEN a.started_date END) AS s2_started,
    MAX(CASE WHEN a.stage_number = m.old2 THEN a.completed_date END) AS s2_completed,
    MAX(CASE WHEN a.stage_number = m.old2 THEN a.notes END) AS s2_notes,
    MAX(CASE WHEN a.stage_number = m.old2 THEN a.updated_by END) AS s2_updated_by
  FROM ew_claim_stages a
  JOIN (VALUES
    (1,  1, 2,    'Intimation & Registration'),
    (2,  3, 4,    'Initial Inspection Done'),
    (3,  5, 6,    'Observation Shared'),
    (4,  7, NULL, 'Dismantling Inspection'),
    (5,  8, 9,    'Reinspection'),
    (6,  10, NULL,'Tax Invoice Receipt'),
    (7,  11, NULL,'Assessment'),
    (8,  12, NULL,'Final Survey Report')
  ) AS m(new_stage, old1, old2, new_name)
    ON a.stage_number = m.old1 OR (m.old2 IS NOT NULL AND a.stage_number = m.old2)
  -- Only migrate claims that still have 12-stage data
  WHERE a.ew_claim_id IN (
    SELECT ew_claim_id FROM ew_claim_stages WHERE stage_number > 8 GROUP BY ew_claim_id
  )
  GROUP BY a.ew_claim_id, m.new_stage, m.new_name
) merged;

-- Step 2: Delete old 12-stage rows for migrated claims
DELETE FROM ew_claim_stages
WHERE ew_claim_id IN (
  SELECT DISTINCT ew_claim_id FROM ew_claim_stages WHERE stage_number > 100
)
AND stage_number <= 12;

-- Step 3: Renumber temporary stages 101-108 → 1-8
UPDATE ew_claim_stages
SET stage_number = stage_number - 100
WHERE stage_number > 100;

-- Step 4: Update parent claim's current_stage and current_stage_name
-- Map old current_stage to new numbering
UPDATE ew_vehicle_claims
SET
  current_stage = CASE
    WHEN current_stage IN (1, 2) THEN 1
    WHEN current_stage IN (3, 4) THEN 2
    WHEN current_stage IN (5, 6) THEN 3
    WHEN current_stage = 7 THEN 4
    WHEN current_stage IN (8, 9) THEN 5
    WHEN current_stage = 10 THEN 6
    WHEN current_stage = 11 THEN 7
    WHEN current_stage = 12 THEN 8
    ELSE current_stage
  END,
  current_stage_name = CASE
    WHEN current_stage IN (1, 2) THEN 'Intimation & Registration'
    WHEN current_stage IN (3, 4) THEN 'Initial Inspection Done'
    WHEN current_stage IN (5, 6) THEN 'Observation Shared'
    WHEN current_stage = 7 THEN 'Dismantling Inspection'
    WHEN current_stage IN (8, 9) THEN 'Reinspection'
    WHEN current_stage = 10 THEN 'Tax Invoice Receipt'
    WHEN current_stage = 11 THEN 'Assessment'
    WHEN current_stage = 12 THEN 'Final Survey Report'
    ELSE current_stage_name
  END,
  updated_at = NOW()
WHERE current_stage > 8 OR current_stage_name IN (
  'Claim Intimation', 'Claim Registration', 'Contact Dealer',
  'Initial Inspection', 'Document Analysis', 'Initial Observation Shared',
  'Dismantled Inspection', 'Estimate Approved', 'Reinspection',
  'Tax Invoice Collected', 'Assessment Done', 'FSR Prepared'
);

COMMIT;

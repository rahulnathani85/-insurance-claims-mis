-- ============================================================
-- Migration: Stamp lot membership directly onto ew_vehicle_claims
-- SAFE: Purely additive. Adds lot_id / lot_number columns to the
-- claim row so the MIS page can show the lot a claim belongs to
-- (and colour the row) without joining ew_lot_claims.
--
-- Includes backfill for any lots that already exist, plus a
-- BEFORE DELETE trigger on ew_lots so removing a lot automatically
-- clears lot_number / lot_id on every participating claim.
-- ============================================================

BEGIN;

-- 1. Columns on ew_vehicle_claims
ALTER TABLE ew_vehicle_claims
  ADD COLUMN IF NOT EXISTS lot_id BIGINT REFERENCES ew_lots(id) ON DELETE SET NULL;

ALTER TABLE ew_vehicle_claims
  ADD COLUMN IF NOT EXISTS lot_number TEXT;

-- 2. Indexes for fast filter/search
CREATE INDEX IF NOT EXISTS idx_ew_vehicle_claims_lot_id ON ew_vehicle_claims(lot_id);
CREATE INDEX IF NOT EXISTS idx_ew_vehicle_claims_lot_number ON ew_vehicle_claims(lot_number);

-- 3. Backfill existing lot memberships
UPDATE ew_vehicle_claims vc
   SET lot_id     = l.id,
       lot_number = l.lot_number
  FROM ew_lot_claims lc
  JOIN ew_lots l ON l.id = lc.lot_id
 WHERE lc.ew_claim_id = vc.id
   AND (vc.lot_id IS DISTINCT FROM l.id OR vc.lot_number IS DISTINCT FROM l.lot_number);

-- 4. Trigger: when a lot is deleted, null out lot_number on all its claims.
-- (lot_id is handled by the FK ON DELETE SET NULL, but lot_number is plain TEXT
-- and needs explicit cleanup so the MIS row loses its green highlight.)
CREATE OR REPLACE FUNCTION clear_ew_claim_lot_number_on_lot_delete()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE ew_vehicle_claims
     SET lot_number = NULL
   WHERE lot_id = OLD.id
      OR lot_number = OLD.lot_number;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clear_ew_claim_lot_number_on_lot_delete ON ew_lots;
CREATE TRIGGER trg_clear_ew_claim_lot_number_on_lot_delete
BEFORE DELETE ON ew_lots
FOR EACH ROW EXECUTE FUNCTION clear_ew_claim_lot_number_on_lot_delete();

-- 5. Trigger: when lot_number on ew_lots is renamed, propagate to claim rows
CREATE OR REPLACE FUNCTION sync_ew_claim_lot_number_on_lot_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lot_number IS DISTINCT FROM OLD.lot_number THEN
    UPDATE ew_vehicle_claims
       SET lot_number = NEW.lot_number
     WHERE lot_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_ew_claim_lot_number_on_lot_update ON ew_lots;
CREATE TRIGGER trg_sync_ew_claim_lot_number_on_lot_update
AFTER UPDATE OF lot_number ON ew_lots
FOR EACH ROW EXECUTE FUNCTION sync_ew_claim_lot_number_on_lot_update();

COMMIT;

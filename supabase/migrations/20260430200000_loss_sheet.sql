-- =============================================================================
-- Loss Sheet builder (CLAUDE.md §11 #4 — Phase 1 Fire LOB MVP closeout)
-- =============================================================================
-- 30 Apr 2026
--
-- Two tables:
--   loss_sheets        one row per claim (header — sum_insured, var, excess,
--                      grand totals)
--   loss_sheet_items   line items: category, RV, age, depreciation %,
--                      depreciated value, salvage, net loss
--
-- Calculation contract (see lib/lossSheet/calculate.js):
--
--   For each item:
--     depreciated_value = rv × (1 - depreciation_pct/100)
--     net_loss          = depreciated_value − salvage
--
--   For the claim:
--     value_at_risk     = Σ(item.rv)
--     gross_loss        = Σ(item.net_loss)
--     underins_factor   = min(1, sum_insured / value_at_risk)         when var > 0
--     adjusted_loss     = gross_loss × underins_factor
--     net_payable       = max(0, adjusted_loss − excess)
--
-- All money fields stored as NUMERIC(15,2) in INR rupees (NOT paise — the
-- existing claims.gross_loss / claims.assessed_loss columns are also
-- rupee-valued NUMERIC; we stay consistent for now). Future provenance
-- Phase B will convert these to typed FieldValues with paise integers.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. loss_sheets — claim header
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.loss_sheets (
    id                    BIGSERIAL    PRIMARY KEY,
    claim_id              BIGINT       NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,

    -- Inputs
    sum_insured           NUMERIC(15, 2),
    excess_amount         NUMERIC(15, 2) NOT NULL DEFAULT 0,

    -- Computed totals (denormalised — recomputed on every line-item change)
    value_at_risk         NUMERIC(15, 2) NOT NULL DEFAULT 0,
    gross_loss            NUMERIC(15, 2) NOT NULL DEFAULT 0,
    underinsurance_factor NUMERIC(8, 6),                    -- 0..1, null when SI/VAR not computable
    adjusted_loss         NUMERIC(15, 2) NOT NULL DEFAULT 0,
    net_payable           NUMERIC(15, 2) NOT NULL DEFAULT 0,

    -- Workflow
    status                TEXT         NOT NULL DEFAULT 'draft',
    notes                 TEXT,

    company               TEXT         NOT NULL DEFAULT 'NISLA',
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by            TEXT,
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by            TEXT
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loss_sheets_claim_unique') THEN
        ALTER TABLE public.loss_sheets
            ADD CONSTRAINT loss_sheets_claim_unique UNIQUE (claim_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loss_sheets_status_check') THEN
        ALTER TABLE public.loss_sheets
            ADD CONSTRAINT loss_sheets_status_check
            CHECK (status IN ('draft', 'under_review', 'approved', 'superseded'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_loss_sheets_claim_id ON public.loss_sheets (claim_id);

ALTER TABLE public.loss_sheets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'loss_sheets'
          AND policyname = 'Allow all access to loss_sheets'
    ) THEN
        CREATE POLICY "Allow all access to loss_sheets" ON public.loss_sheets
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.loss_sheets
    IS 'CLAUDE.md §7 / §11: per-claim loss computation header. One row per claim. Totals are denormalised — kept in sync by the API on every line-item mutation.';

-- -----------------------------------------------------------------------------
-- 2. loss_sheet_items — line items
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.loss_sheet_items (
    id                       BIGSERIAL    PRIMARY KEY,
    loss_sheet_id            BIGINT       NOT NULL REFERENCES public.loss_sheets(id) ON DELETE CASCADE,
    claim_id                 BIGINT       NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,

    -- Item identity
    item_no                  INTEGER      NOT NULL,
    description              TEXT         NOT NULL,
    category                 TEXT         NOT NULL,

    -- Quantification (all in INR rupees)
    quantity                 NUMERIC(15, 4) NOT NULL DEFAULT 1,
    unit                     TEXT,
    replacement_value        NUMERIC(15, 2) NOT NULL,         -- RV per item × quantity

    -- Depreciation
    age_years                NUMERIC(6, 2),
    depreciation_pct         NUMERIC(5, 2),                   -- caller-applied or auto from config
    depreciation_pct_override BOOLEAN     NOT NULL DEFAULT false,
    depreciated_value        NUMERIC(15, 2) NOT NULL,         -- rv × (1 − dep/100)

    -- Salvage
    salvage_value            NUMERIC(15, 2) NOT NULL DEFAULT 0,

    -- Computed
    net_loss                 NUMERIC(15, 2) NOT NULL,         -- depreciated − salvage

    notes                    TEXT,

    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loss_sheet_items_item_no_unique') THEN
        ALTER TABLE public.loss_sheet_items
            ADD CONSTRAINT loss_sheet_items_item_no_unique UNIQUE (loss_sheet_id, item_no);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loss_sheet_items_dep_pct_check') THEN
        ALTER TABLE public.loss_sheet_items
            ADD CONSTRAINT loss_sheet_items_dep_pct_check
            CHECK (depreciation_pct IS NULL OR (depreciation_pct >= 0 AND depreciation_pct <= 100));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_loss_sheet_items_sheet  ON public.loss_sheet_items (loss_sheet_id);
CREATE INDEX IF NOT EXISTS idx_loss_sheet_items_claim  ON public.loss_sheet_items (claim_id);

ALTER TABLE public.loss_sheet_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'loss_sheet_items'
          AND policyname = 'Allow all access to loss_sheet_items'
    ) THEN
        CREATE POLICY "Allow all access to loss_sheet_items" ON public.loss_sheet_items
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON COLUMN public.loss_sheet_items.depreciation_pct_override
    IS 'true = surveyor manually overrode the auto-suggested depreciation from config/depreciation.js. UI shows the override badge so reviewers can spot exceptions.';
COMMENT ON COLUMN public.loss_sheet_items.depreciated_value
    IS 'replacement_value × (1 - depreciation_pct/100). Stored denormalised so claim aggregates can be computed without re-deriving every row.';
COMMENT ON COLUMN public.loss_sheet_items.net_loss
    IS 'depreciated_value − salvage_value. Σ(net_loss) per claim feeds loss_sheets.gross_loss.';

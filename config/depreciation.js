// =============================================================================
// config/depreciation.js
// =============================================================================
// Item-category-driven depreciation curves used by the Loss Sheet builder.
//
// Sources blended:
//   - General Insurance Council guidance for Fire / Engineering claims
//   - GIC PSU practice tables for property valuation
//   - IRDAI surveyor handbook (depreciation conventions)
//
// Each category exposes:
//   - rate_per_year   number   percentage of value lost each year
//   - max_dep_pct     number   cap on cumulative depreciation
//   - notes           string   surveyor-facing rationale
//
// computeDepreciation(category, ageYears) returns a clamped percentage
// (0–max_dep_pct/100) you can multiply against the replacement value.
//
// CLAUDE.md §7 lists "Depreciation is item-category driven from
// `config/depreciation.ts`" as the binding contract — this file is the
// JS variant matching the live codebase convention.
//
// Editable without deployment: surveyors disagreeing with a curve should
// override per-line at the loss-sheet level (depreciation_pct_override
// column on loss_sheet_items). The config is the default suggestion.
// =============================================================================

export const DEPRECIATION_CATEGORIES = {
  // ---------------- Property / building ----------------
  building_rcc: {
    label: 'Building — RCC structure',
    rate_per_year: 1,
    max_dep_pct: 50,
    notes: 'Reinforced concrete; ~100 yr life; 1% straight-line.',
  },
  building_brick: {
    label: 'Building — Brick / stone (load-bearing)',
    rate_per_year: 1.25,
    max_dep_pct: 60,
    notes: 'Conventional masonry; 80 yr life.',
  },
  building_kuccha: {
    label: 'Building — Kuccha / temporary',
    rate_per_year: 5,
    max_dep_pct: 80,
    notes: 'Sheds, thatched; 20 yr life.',
  },

  // ---------------- Plant & machinery ----------------
  machinery_general: {
    label: 'Plant & Machinery — General',
    rate_per_year: 5,
    max_dep_pct: 80,
    notes: 'Standard industrial machinery.',
  },
  machinery_heavy: {
    label: 'Plant & Machinery — Heavy',
    rate_per_year: 4,
    max_dep_pct: 70,
    notes: 'Boilers, turbines, presses.',
  },
  machinery_special_purpose: {
    label: 'Plant & Machinery — Special purpose',
    rate_per_year: 6,
    max_dep_pct: 80,
    notes: 'Specialised single-use equipment.',
  },

  // ---------------- Electrical / electronic ----------------
  electrical_installation: {
    label: 'Electrical installation',
    rate_per_year: 5,
    max_dep_pct: 75,
    notes: 'Wiring, panels, transformers.',
  },
  electronic_equipment: {
    label: 'Electronic equipment',
    rate_per_year: 10,
    max_dep_pct: 85,
    notes: 'Test/measure/lab instruments.',
  },
  computers_it: {
    label: 'Computers / IT',
    rate_per_year: 20,
    max_dep_pct: 90,
    notes: '5-yr useful life; rapid obsolescence.',
  },

  // ---------------- Furniture / fittings ----------------
  furniture: {
    label: 'Furniture & fittings',
    rate_per_year: 7.5,
    max_dep_pct: 80,
    notes: 'Office / commercial furniture.',
  },
  fixtures: {
    label: 'Fixtures (built-in)',
    rate_per_year: 5,
    max_dep_pct: 75,
    notes: 'Cabinetry, partitions, false ceiling.',
  },

  // ---------------- Stocks (no depreciation) ----------------
  stock_raw_material: {
    label: 'Stock — Raw material',
    rate_per_year: 0,
    max_dep_pct: 0,
    notes: 'Fresh; no depreciation. Quantum is RV.',
  },
  stock_wip: {
    label: 'Stock — Work in progress',
    rate_per_year: 0,
    max_dep_pct: 0,
    notes: 'Cost-plus-conversion; no depreciation.',
  },
  stock_finished_goods: {
    label: 'Stock — Finished goods',
    rate_per_year: 0,
    max_dep_pct: 0,
    notes: 'Sale-price-less-margin; no depreciation.',
  },

  // ---------------- Vehicles ----------------
  vehicle_two_wheeler: {
    label: 'Vehicle — Two-wheeler',
    rate_per_year: 10,
    max_dep_pct: 70,
    notes: 'IRDAI motor depreciation; WDV-based.',
  },
  vehicle_car: {
    label: 'Vehicle — Private car',
    rate_per_year: 10,
    max_dep_pct: 70,
    notes: 'Per IRDAI Indian motor tariff.',
  },
  vehicle_commercial: {
    label: 'Vehicle — Commercial',
    rate_per_year: 12,
    max_dep_pct: 75,
    notes: 'Higher wear — GCV / PCV.',
  },

  // ---------------- Catch-all ----------------
  other: {
    label: 'Other',
    rate_per_year: 5,
    max_dep_pct: 80,
    notes: 'Default; surveyor should pick a more specific category.',
  },
};

// Returns depreciation as a 0-1 fraction (e.g. 0.25 = 25% depreciated).
// Caller multiplies replacement_value × (1 - dep) to get depreciated value.
//
// ageYears may be fractional (e.g. 3.5).
export function computeDepreciation(category, ageYears) {
  const cfg = DEPRECIATION_CATEGORIES[category];
  if (!cfg) return null;
  const age = Number(ageYears);
  if (!Number.isFinite(age) || age < 0) return 0;
  const raw = (cfg.rate_per_year || 0) * age / 100;
  const cap = (cfg.max_dep_pct || 0) / 100;
  return Math.min(raw, cap);
}

// List of categories suitable for a UI <select> dropdown.
export const DEPRECIATION_OPTIONS = Object.entries(DEPRECIATION_CATEGORIES)
  .map(([value, cfg]) => ({ value, label: cfg.label, max: cfg.max_dep_pct }));

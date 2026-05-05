// =============================================================================
// tests/fsrNarrativeFields.test.js
// =============================================================================
// Phase 1b: tests for the Marine Cargo / Ultratech narrative form.
// Covers:
//   - fieldsForLob dispatch by templateName
//   - the new MARINE_CARGO_ULTRATECH_FIELDS shape (declares placeholders that
//     match the {{narrative.*}} keys baked into Ultratech_Marine_Cargo_v1)
//   - labelForPlaceholder finding Ultratech-only keys
//   - array-field editor pure helpers (insert / delete / update / coerce)
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  fieldsForLob,
  allKeysFor,
  labelForPlaceholder,
  __FIELD_GROUPS__,
} from '../lib/fsr/narrativeFields.js';
import {
  emptyRowFor,
  applyArrayRowChange,
  insertArrayRow,
  deleteArrayRow,
  coerceArrayRows,
} from '../lib/fsr/arrayFieldEditor.js';

// ============================================================================
// fieldsForLob — template-name dispatch
// ============================================================================

describe('fieldsForLob', () => {
  it('returns Ultratech-specific fields for Marine Cargo + Ultratech_Marine_Cargo_v1', () => {
    const result = fieldsForLob('Marine Cargo', 'Ultratech_Marine_Cargo_v1');
    expect(result).toBe(__FIELD_GROUPS__.MARINE_CARGO_ULTRATECH_FIELDS);
    // Sanity: at least one section, and section titles match the Phase 1b
    // structure documented in the plan.
    expect(result.length).toBeGreaterThanOrEqual(7);
    const titles = result.map((s) => s.title);
    expect(titles).toContain('Consignor + Consignee');
    expect(titles).toContain('Damaged items breakdown');
    expect(titles).toContain('Assessment numbers');
  });

  it('returns generic Marine fields when templateName is Production', () => {
    const result = fieldsForLob('Marine Cargo', 'Production');
    expect(result).toBe(__FIELD_GROUPS__.MARINE_FIELDS);
  });

  it('returns generic Marine fields when templateName is omitted (defaults Production)', () => {
    expect(fieldsForLob('Marine Cargo')).toBe(__FIELD_GROUPS__.MARINE_FIELDS);
  });

  it('Marine Hull is unaffected by the Ultratech template name', () => {
    expect(fieldsForLob('Marine Hull', 'Ultratech_Marine_Cargo_v1')).toBe(__FIELD_GROUPS__.MARINE_HULL_FIELDS);
  });

  it('appends ILA extras for templateName=ILA (generic LOBs)', () => {
    const fire = fieldsForLob('Fire', 'ILA');
    expect(fire.length).toBe(__FIELD_GROUPS__.FIRE_FIELDS.length + __FIELD_GROUPS__.ILA_EXTRAS.length);
  });

  it('Ultratech template ignores ILA extras (template-specific overrides take precedence)', () => {
    // If a future need arises to add ILA sections to the Ultratech variant,
    // it would be a deliberate change to the field set itself, not a
    // dispatch tweak. Guard against accidental ILA bleed-through.
    const ult = fieldsForLob('Marine Cargo', 'Ultratech_Marine_Cargo_v1');
    expect(ult).toBe(__FIELD_GROUPS__.MARINE_CARGO_ULTRATECH_FIELDS);
  });
});

// ============================================================================
// MARINE_CARGO_ULTRATECH_FIELDS — required keys match the template
// ============================================================================

describe('MARINE_CARGO_ULTRATECH_FIELDS coverage', () => {
  // These keys MUST exist in the Ultratech narrative form because they're
  // referenced as {{narrative.<key>}} in the body_html of
  // Ultratech_Marine_Cargo_v1 (migration 20260504173522). If the migration
  // changes the placeholders, this test should be updated to match.
  const REQUIRED_KEYS = [
    'consignor_name', 'consignor_address',
    'consignee_name', 'consignee_address',
    'rr_no', 'rr_date',
    'transit_from', 'transit_to',
    'mode_of_transit', 'type_of_load', 'type_of_packing', 'cargo_type',
    'date_of_dispatch', 'date_of_arrival', 'place_of_arrival',
    'invoice_details_block', 'total_consignment_value_inr_ult',
    'consignment_weight_bags', 'consignment_weight_mt',
    'type_of_loss', 'cause_of_loss_short', 'nature_of_loss', 'extent_of_loss',
    'catastrophic_event', 'accident_loss', 'import_leg_loss', 'inter_depot_movement',
    'loss_location_label', 'fir_status', 'carrier_name',
    'vehicle_present_at_visit', 'storage_condition', 'cargo_segregated',
    'packing_external_condition',
    'incident_narrative', 'observation_narrative',
    'damaged_items',
    'rate_per_mt_inr', 'freight_per_mt_inr',
    'treatment_of_tax_note', 'salvage_amount_note', 'salvage_pickup_date', 'salvage_buyer',
    'insurer_team_salvage', 'excess_amount_inr',
    'gross_assessed_loss_inr', 'net_adjusted_loss_inr_ult', 'net_adjusted_loss_words_ult',
    'average_pct_loss',
    'recommendation_text', 'recommendation_amount_inr', 'recommendation_amount_words',
    'final_doc_submission_date', 'consent_date', 'delay_reason',
    'interest_insured', 'policy_packing_details', 'policy_conveyance', 'policy_voyage',
    'policy_coverage_type', 'policy_basis_of_valuation', 'policy_excess', 'policy_type_label',
  ];

  const allKeys = allKeysFor('Marine Cargo', 'Ultratech_Marine_Cargo_v1');

  it.each(REQUIRED_KEYS)('declares the "%s" placeholder', (key) => {
    expect(allKeys).toContain(key);
  });

  it('declares damaged_items as type=array', () => {
    const sections = fieldsForLob('Marine Cargo', 'Ultratech_Marine_Cargo_v1');
    const di = sections.flatMap((s) => s.fields).find((f) => f.key === 'damaged_items');
    expect(di).toBeDefined();
    expect(di.type).toBe('array');
    expect(Array.isArray(di.itemSchema)).toBe(true);
    expect(di.itemSchema.length).toBeGreaterThan(0);
    // Each column must declare key + label.
    for (const col of di.itemSchema) {
      expect(typeof col.key).toBe('string');
      expect(typeof col.label).toBe('string');
    }
    // Required columns for the FSR's two breakdown tables.
    const colKeys = di.itemSchema.map((c) => c.key);
    for (const k of [
      'invoice_no', 'description', 'pack_size',
      'total_dispatched_bags', 'total_dispatched_mt',
      'damaged_bags', 'damaged_mt', 'extent_pct',
      'loss_allowed_bags', 'loss_allowed_mt',
    ]) {
      expect(colKeys).toContain(k);
    }
  });

  it('every section has at least one field', () => {
    const sections = fieldsForLob('Marine Cargo', 'Ultratech_Marine_Cargo_v1');
    for (const sec of sections) {
      expect(sec.fields.length).toBeGreaterThan(0);
    }
  });

  it('every field has key + label + valid type', () => {
    const sections = fieldsForLob('Marine Cargo', 'Ultratech_Marine_Cargo_v1');
    for (const sec of sections) {
      for (const f of sec.fields) {
        expect(typeof f.key).toBe('string');
        expect(typeof f.label).toBe('string');
        if (f.type) {
          expect(['text', 'textarea', 'date', 'array']).toContain(f.type);
        }
      }
    }
  });
});

// ============================================================================
// labelForPlaceholder
// ============================================================================

describe('labelForPlaceholder', () => {
  it('finds Ultratech-only keys', () => {
    expect(labelForPlaceholder('narrative.consignor_name')).toBe('Consignor name');
    expect(labelForPlaceholder('narrative.damaged_items')).toMatch(/damaged items/i);
  });

  it('finds generic Marine keys', () => {
    expect(labelForPlaceholder('narrative.lr_no')).toMatch(/LR/);
  });

  it('returns the bare key for unknown placeholders', () => {
    expect(labelForPlaceholder('narrative.who_knows_what')).toBe('who_knows_what');
  });

  it('passes non-narrative paths through unchanged', () => {
    expect(labelForPlaceholder('claim.ref_number')).toBe('claim.ref_number');
  });
});

// ============================================================================
// arrayFieldEditor — pure helpers
// ============================================================================

const SAMPLE_SCHEMA = [
  { key: 'invoice_no',    label: 'Invoice', type: 'text',   colWidth: 100 },
  { key: 'description',   label: 'Desc',    type: 'text',   colWidth: 100 },
  { key: 'damaged_bags',  label: 'Bags',    type: 'number', colWidth: 80  },
];

describe('emptyRowFor', () => {
  it('returns an object with every schema key set to empty string', () => {
    const row = emptyRowFor(SAMPLE_SCHEMA);
    expect(row).toEqual({ invoice_no: '', description: '', damaged_bags: '' });
  });
  it('returns empty object for non-array schema', () => {
    expect(emptyRowFor(null)).toEqual({});
    expect(emptyRowFor(undefined)).toEqual({});
    expect(emptyRowFor('not a schema')).toEqual({});
  });
  it('skips non-string keys safely', () => {
    const row = emptyRowFor([{ key: 'a' }, { key: null }, { /* missing key */ }, { key: 'b' }]);
    expect(row).toEqual({ a: '', b: '' });
  });
});

describe('applyArrayRowChange', () => {
  const rows = [
    { invoice_no: 'A', description: 'foo', damaged_bags: 10 },
    { invoice_no: 'B', description: 'bar', damaged_bags: 20 },
  ];

  it('updates a single cell without mutating input', () => {
    const out = applyArrayRowChange(rows, 0, 'damaged_bags', 99);
    expect(out[0].damaged_bags).toBe(99);
    expect(out[1]).toEqual(rows[1]);
    // Input untouched.
    expect(rows[0].damaged_bags).toBe(10);
    expect(out).not.toBe(rows);
  });

  it('returns input unchanged for out-of-range index', () => {
    expect(applyArrayRowChange(rows, 5, 'a', 1)).toBe(rows);
    expect(applyArrayRowChange(rows, -1, 'a', 1)).toBe(rows);
  });

  it('returns input unchanged for empty/invalid columnKey', () => {
    expect(applyArrayRowChange(rows, 0, '', 1)).toBe(rows);
    expect(applyArrayRowChange(rows, 0, null, 1)).toBe(rows);
  });

  it('returns input unchanged for non-array rows', () => {
    expect(applyArrayRowChange(null, 0, 'a', 1)).toBeNull();
    expect(applyArrayRowChange('notarray', 0, 'a', 1)).toBe('notarray');
  });

  it('preserves other keys on the row when patching one', () => {
    const out = applyArrayRowChange(rows, 1, 'damaged_bags', 0);
    expect(out[1]).toEqual({ invoice_no: 'B', description: 'bar', damaged_bags: 0 });
  });
});

describe('insertArrayRow', () => {
  it('appends an empty row at the end by default', () => {
    const out = insertArrayRow([{ a: 1 }], SAMPLE_SCHEMA);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual(emptyRowFor(SAMPLE_SCHEMA));
  });
  it('inserts at a specific index', () => {
    const out = insertArrayRow([{ a: 1 }, { a: 2 }], SAMPLE_SCHEMA, 1);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual(emptyRowFor(SAMPLE_SCHEMA));
    expect(out[2]).toEqual({ a: 2 });
  });
  it('treats a non-array rows input as empty', () => {
    const out = insertArrayRow(null, SAMPLE_SCHEMA);
    expect(out).toHaveLength(1);
  });
  it('does not mutate the input array', () => {
    const input = [{ a: 1 }];
    insertArrayRow(input, SAMPLE_SCHEMA);
    expect(input).toEqual([{ a: 1 }]);
  });
});

describe('deleteArrayRow', () => {
  it('removes the row at the given index', () => {
    const out = deleteArrayRow([{ a: 1 }, { a: 2 }, { a: 3 }], 1);
    expect(out).toEqual([{ a: 1 }, { a: 3 }]);
  });
  it('returns input unchanged for out-of-range index', () => {
    const rows = [{ a: 1 }];
    expect(deleteArrayRow(rows, 5)).toBe(rows);
    expect(deleteArrayRow(rows, -1)).toBe(rows);
  });
  it('does not mutate the input array', () => {
    const input = [{ a: 1 }, { a: 2 }];
    deleteArrayRow(input, 0);
    expect(input).toHaveLength(2);
  });
});

describe('coerceArrayRows', () => {
  it('fills in missing schema keys on each row', () => {
    const out = coerceArrayRows([{ invoice_no: 'A' }], SAMPLE_SCHEMA);
    expect(out[0]).toEqual({ invoice_no: 'A', description: '', damaged_bags: '' });
  });
  it('preserves extra keys on rows (allows schema to grow over time)', () => {
    const out = coerceArrayRows([{ invoice_no: 'A', extra: 'x' }], SAMPLE_SCHEMA);
    expect(out[0].extra).toBe('x');
  });
  it('replaces non-object rows with empty rows', () => {
    const out = coerceArrayRows([null, 'string', 42, { invoice_no: 'A' }], SAMPLE_SCHEMA);
    expect(out[0]).toEqual({ invoice_no: '', description: '', damaged_bags: '' });
    expect(out[1]).toEqual({ invoice_no: '', description: '', damaged_bags: '' });
    expect(out[2]).toEqual({ invoice_no: '', description: '', damaged_bags: '' });
    expect(out[3].invoice_no).toBe('A');
  });
  it('returns [] for non-array input', () => {
    expect(coerceArrayRows(null, SAMPLE_SCHEMA)).toEqual([]);
    expect(coerceArrayRows('not array', SAMPLE_SCHEMA)).toEqual([]);
  });
});

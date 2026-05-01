// =============================================================================
// tests/provenanceDualWrite.test.js
// =============================================================================
// Unit tests for lib/provenance/dualWrite.js + lib/provenance/read.js.
//
// Uses an in-memory mock Supabase client (just enough surface to satisfy the
// query-builder calls these helpers make). The decision engine itself has
// its own exhaustive coverage in tests/provenance.test.js — this file
// focuses on the orchestration: which DB operations happen for each
// scenario, and how the merge-read combines column + provenance values.
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  dualWriteClaimFields,
  PROVENANCE_MANAGED_FIELDS,
  FIELD_HAS_CLAIMS_COLUMN,
} from '../lib/provenance/dualWrite.js';
import {
  getClaimWithProvenance,
  fieldValueToPrimitive,
} from '../lib/provenance/read.js';

// -----------------------------------------------------------------------------
// Mock supabase — minimal stub of the chained query builder we use.
// -----------------------------------------------------------------------------

function mockSupabase(initial = {}) {
  const tables = {
    claims: initial.claims || [],
    claim_field_values: initial.claim_field_values || [],
    field_source_authority: initial.field_source_authority || [],
    field_change_policy: initial.field_change_policy || [],
    v_current_claim_fields: [], // populated lazily
  };
  const log = [];

  function rebuildView() {
    tables.v_current_claim_fields = tables.claim_field_values
      .filter((r) => r.is_current === true)
      .map((r) => ({
        claim_id: r.claim_id,
        field_name: r.field_name,
        value: r.value,
        value_normalized: r.value_normalized,
        source_type: r.source_type,
        source_document_type: r.source_document_type,
        source_label: r.source_label,
        extracted_by: r.extracted_by,
        extraction_confidence: r.extraction_confidence,
        captured_at: r.captured_at,
        captured_by: r.captured_by,
        has_pending_conflict: tables.claim_field_values.some(
          (r2) => r2.claim_id === r.claim_id && r2.field_name === r.field_name && r2.conflict_status === 'pending'
        ),
      }));
  }

  function builder(tableName) {
    let filters = [];
    let mode = 'select';
    let inserts = null;
    let updates = null;
    let returnSingle = false;
    let returnMaybeSingle = false;

    const obj = {
      select() { return obj; },
      eq(col, val) { filters.push((r) => r[col] === val); return obj; },
      not(col, op, val) {
        if (op === 'is' && val === null) filters.push((r) => r[col] !== null);
        return obj;
      },
      neq(col, val) { filters.push((r) => r[col] !== val); return obj; },
      in(col, arr) { filters.push((r) => arr.includes(r[col])); return obj; },
      ilike() { return obj; },
      lte() { return obj; },
      order() { return obj; },
      limit() { return obj; },
      single() { returnSingle = true; return obj.then ? obj.then() : run(); },
      maybeSingle() { returnMaybeSingle = true; return run(); },
      insert(rows) { mode = 'insert'; inserts = Array.isArray(rows) ? rows : [rows]; return obj; },
      update(patch) { mode = 'update'; updates = patch; return obj; },
      then(resolve, reject) { return run().then(resolve, reject); },
    };

    function run() {
      let rows = tables[tableName] || [];
      const matching = (r) => filters.every((f) => f(r));

      if (mode === 'insert') {
        const toAdd = inserts.map((row) => ({
          ...row,
          id: row.id || `${tableName}-${(tables[tableName].length + 1)}-${Math.random().toString(36).slice(2, 8)}`,
          captured_at: row.captured_at || new Date().toISOString(),
        }));
        log.push({ op: 'insert', table: tableName, rows: toAdd });
        tables[tableName].push(...toAdd);
        if (tableName === 'claim_field_values') rebuildView();
        const data = returnSingle || returnMaybeSingle ? toAdd[0] : toAdd;
        return Promise.resolve({ data, error: null });
      }

      if (mode === 'update') {
        const updated = [];
        rows.forEach((r, i) => {
          if (matching(r)) {
            tables[tableName][i] = { ...r, ...updates };
            updated.push(tables[tableName][i]);
          }
        });
        log.push({ op: 'update', table: tableName, patch: updates, count: updated.length });
        if (tableName === 'claim_field_values') rebuildView();
        const data = returnSingle || returnMaybeSingle ? updated[0] || null : updated;
        return Promise.resolve({ data, error: null });
      }

      // select
      const matched = rows.filter(matching);
      if (returnSingle) {
        if (matched.length !== 1) {
          return Promise.resolve({ data: null, error: matched.length === 0 ? { message: 'no rows' } : { message: 'multiple rows' } });
        }
        return Promise.resolve({ data: matched[0], error: null });
      }
      if (returnMaybeSingle) {
        return Promise.resolve({ data: matched[0] || null, error: null });
      }
      return Promise.resolve({ data: matched, error: null });
    }

    return obj;
  }

  rebuildView();
  return {
    from: (tableName) => builder(tableName),
    _log: log,
    _tables: tables,
  };
}

// -----------------------------------------------------------------------------
// dualWriteClaimFields
// -----------------------------------------------------------------------------

describe('PROVENANCE_MANAGED_FIELDS', () => {
  it('lists the canonical fields', () => {
    expect(PROVENANCE_MANAGED_FIELDS).toContain('sum_insured');
    expect(PROVENANCE_MANAGED_FIELDS).toContain('gross_loss');
    expect(PROVENANCE_MANAGED_FIELDS).toContain('policy_number');
    expect(PROVENANCE_MANAGED_FIELDS).toContain('insured_name');
    expect(PROVENANCE_MANAGED_FIELDS).toContain('lob');
  });

  it('flags fields with no backing column', () => {
    expect(FIELD_HAS_CLAIMS_COLUMN.sum_insured).toBe(false);
    expect(FIELD_HAS_CLAIMS_COLUMN.peril_type).toBe(false);
    expect(FIELD_HAS_CLAIMS_COLUMN.gross_loss).toBe(true);
    expect(FIELD_HAS_CLAIMS_COLUMN.policy_number).toBe(true);
  });
});

describe('dualWriteClaimFields — empty field (auto_update_safe)', () => {
  let supabase;
  beforeEach(() => {
    supabase = mockSupabase({
      claims: [{ id: 1, ref_number: '4053/26-27/Fire' }],
      field_source_authority: [
        { field_name: 'gross_loss', source_document_type: 'manual_entry', authority_rank: 2 },
      ],
      field_change_policy: [
        { field_name: '__default__', scenario: 'empty_to_value', action: 'auto_update' },
        { field_name: '__default__', scenario: 'higher_authority', action: 'raise_conflict' },
      ],
    });
  });

  it('writes a current=true row when field is empty', async () => {
    const out = await dualWriteClaimFields(supabase, 1, { gross_loss: 500_000 }, {
      type: 'manual', documentType: 'manual_entry', label: 'test', capturedBy: 'a@b.com',
    });
    expect(out.provenance).toHaveLength(1);
    const r = out.provenance[0];
    expect(r.field_name).toBe('gross_loss');
    expect(r.decision.kind).toBe('auto_update_safe');
    expect(r.written).toBe(true);
    expect(supabase._tables.claim_field_values).toHaveLength(1);
    expect(supabase._tables.claim_field_values[0].is_current).toBe(true);
  });

  it('coerces money input into integer paise', async () => {
    await dualWriteClaimFields(supabase, 1, { gross_loss: '₹5,00,000' }, {
      type: 'manual', documentType: 'manual_entry', label: 'test',
    });
    const row = supabase._tables.claim_field_values[0];
    expect(row.value.kind).toBe('money');
    expect(row.value.amount).toBe(50_000_000); // 5 lakh rupees in paise
  });
});

describe('dualWriteClaimFields — same value (corroborate)', () => {
  it('records evidence without flipping is_current when value matches', async () => {
    const supabase = mockSupabase({
      claims: [{ id: 1 }],
      claim_field_values: [{
        id: 'existing-1',
        claim_id: 1,
        field_name: 'gross_loss',
        value: { kind: 'money', amount: 50_000_000, currency: 'INR' },
        value_normalized: '50000000',
        source_type: 'document',
        source_document_type: 'policy_schedule',
        is_current: true,
        captured_at: '2026-01-01T00:00:00Z',
      }],
      field_source_authority: [
        { field_name: 'gross_loss', source_document_type: 'policy_schedule', authority_rank: 2 },
        { field_name: 'gross_loss', source_document_type: 'manual_entry', authority_rank: 5 },
      ],
      field_change_policy: [
        { field_name: '__default__', scenario: 'equal_value', action: 'corroborate' },
      ],
    });

    const out = await dualWriteClaimFields(supabase, 1, { gross_loss: 500_000 }, {
      type: 'manual', documentType: 'manual_entry', label: 'test',
    });

    expect(out.provenance[0].decision.kind).toBe('corroborate');
    // Original row stays current
    const cur = supabase._tables.claim_field_values.filter((r) => r.is_current);
    expect(cur).toHaveLength(1);
    expect(cur[0].id).toBe('existing-1');
    // New evidence row exists
    expect(supabase._tables.claim_field_values.length).toBe(2);
    const newRow = supabase._tables.claim_field_values.find((r) => r.id !== 'existing-1');
    expect(newRow.is_current).toBe(false);
  });
});

describe('dualWriteClaimFields — higher authority (raise_conflict)', () => {
  it('marks new row pending when higher-authority disagrees', async () => {
    const supabase = mockSupabase({
      claims: [{ id: 1 }],
      claim_field_values: [{
        id: 'existing-1',
        claim_id: 1,
        field_name: 'sum_insured',
        value: { kind: 'money', amount: 5_000_000_000, currency: 'INR' },
        value_normalized: '5000000000',
        source_type: 'document',
        source_document_type: 'policy_schedule',
        is_current: true,
      }],
      field_source_authority: [
        { field_name: 'sum_insured', source_document_type: 'endorsement',     authority_rank: 1 },
        { field_name: 'sum_insured', source_document_type: 'policy_schedule', authority_rank: 2 },
      ],
      field_change_policy: [
        { field_name: '__default__', scenario: 'higher_authority', action: 'raise_conflict' },
      ],
    });

    const out = await dualWriteClaimFields(supabase, 1, { sum_insured: 7_500_000 }, {
      type: 'document', documentType: 'endorsement', label: 'Endorsement Apr 2026',
    });

    expect(out.provenance[0].decision.kind).toBe('raise_conflict');
    const newRow = supabase._tables.claim_field_values.find((r) => r.id !== 'existing-1');
    expect(newRow.conflict_status).toBe('pending');
    expect(newRow.is_current).toBe(false);
    expect(newRow.conflict_reason).toMatch(/higher-authority/i);
    // Original row remains current — humans must resolve.
    const cur = supabase._tables.claim_field_values.find((r) => r.is_current);
    expect(cur.id).toBe('existing-1');
  });
});

describe('dualWriteClaimFields — multiple fields in one call', () => {
  it('processes each field independently', async () => {
    const supabase = mockSupabase({
      claims: [{ id: 1 }],
      field_source_authority: [],
      field_change_policy: [
        { field_name: '__default__', scenario: 'empty_to_value', action: 'auto_update' },
      ],
    });

    const out = await dualWriteClaimFields(
      supabase, 1,
      {
        gross_loss: 500_000,
        insured_name: 'Acme Industries',
        date_loss: '2026-04-30',
        // non-provenance field — should be skipped silently
        ref_number: '4053/26-27/Fire',
      },
      { type: 'manual', documentType: 'manual_entry', label: 'bulk test' }
    );

    const fields = out.provenance.map((r) => r.field_name).sort();
    expect(fields).toEqual(['date_loss', 'gross_loss', 'insured_name']);
    expect(out.skippedNonProvenance).toContain('ref_number');
    expect(out.provenance.every((r) => r.written)).toBe(true);
  });

  it('skips null / empty values (no tombstone yet)', async () => {
    const supabase = mockSupabase({
      claims: [{ id: 1 }],
      field_source_authority: [],
      field_change_policy: [],
    });
    const out = await dualWriteClaimFields(
      supabase, 1,
      { gross_loss: null, insured_name: '' },
      { type: 'manual', documentType: 'manual_entry', label: 't' }
    );
    expect(out.provenance.every((r) => !r.written)).toBe(true);
    expect(supabase._tables.claim_field_values).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// fieldValueToPrimitive
// -----------------------------------------------------------------------------

describe('fieldValueToPrimitive', () => {
  it('money: paise → rupees', () => {
    expect(fieldValueToPrimitive({ kind: 'money', amount: 5_000_000, currency: 'INR' })).toBe(50_000);
  });
  it('date: returns the ISO string', () => {
    expect(fieldValueToPrimitive({ kind: 'date', value: '2026-04-30' })).toBe('2026-04-30');
  });
  it('string: returns the raw value', () => {
    expect(fieldValueToPrimitive({ kind: 'string', value: 'Acme' })).toBe('Acme');
  });
  it('gps: returns { lat, lng }', () => {
    expect(fieldValueToPrimitive({ kind: 'gps', lat: 19.07, lng: 72.87 })).toEqual({ lat: 19.07, lng: 72.87 });
  });
  it('address: joins parts', () => {
    expect(fieldValueToPrimitive({ kind: 'address', line: '123 Main', city: 'Mumbai', pin: '400001' }))
      .toBe('123 Main, Mumbai, 400001');
  });
  it('null / non-object returns input', () => {
    expect(fieldValueToPrimitive(null)).toBe(null);
    expect(fieldValueToPrimitive('hello')).toBe('hello');
  });
});

// -----------------------------------------------------------------------------
// getClaimWithProvenance
// -----------------------------------------------------------------------------

describe('getClaimWithProvenance', () => {
  it('overlays provenance values onto the legacy claim row', async () => {
    const supabase = mockSupabase({
      claims: [{
        id: 1,
        ref_number: '4053/26-27/Fire',
        insured_name: 'Old Name',
        gross_loss: '100000',
        policy_number: 'POL-1',
        lob: 'Fire',
        date_loss: '2026-04-29',
        loss_location: 'Mumbai',
        insurer_name: 'New India',
      }],
      claim_field_values: [{
        id: 'p-1',
        claim_id: 1,
        field_name: 'insured_name',
        value: { kind: 'string', value: 'Acme Industries' },
        value_normalized: 'acme industries',
        source_type: 'document',
        source_document_type: 'policy_schedule',
        source_label: 'Policy schedule p.3',
        extraction_confidence: 0.95,
        captured_at: '2026-04-30T10:00:00Z',
        is_current: true,
      }],
    });

    const out = await getClaimWithProvenance(supabase, 1);

    // Provenance value wins
    expect(out.merged.insured_name).toBe('Acme Industries');
    // Legacy column wins where no provenance exists
    expect(out.merged.gross_loss).toBe('100000');
    expect(out.provenance.insured_name.from_provenance).toBe(true);
    expect(out.provenance.insured_name.confidence).toBe(0.95);
  });

  it('computes a data-quality score from mandatory-field fill rate', async () => {
    const supabase = mockSupabase({
      claims: [{
        id: 1,
        ref_number: 'X',
        insured_name: 'Acme',
        insurer_name: 'NIAC',
        lob: 'Fire',
        date_loss: '2026-04-30',
        loss_location: 'Mumbai',
        policy_number: 'POL-1',
      }],
    });
    const out = await getClaimWithProvenance(supabase, 1);
    expect(out.data_quality.mandatory_total).toBe(6);
    expect(out.data_quality.mandatory_filled).toBe(6);
    expect(out.data_quality.score).toBe(1);
  });

  it('penalises score for pending conflicts', async () => {
    const supabase = mockSupabase({
      claims: [{
        id: 1, insured_name: 'Acme', insurer_name: 'NIAC', lob: 'Fire',
        date_loss: '2026-04-30', loss_location: 'Mumbai', policy_number: 'POL-1',
      }],
      claim_field_values: [
        {
          id: 'p-1', claim_id: 1, field_name: 'sum_insured',
          value: { kind: 'money', amount: 100, currency: 'INR' },
          source_type: 'document', source_document_type: 'policy_schedule',
          is_current: true,
        },
        // simulate a pending conflict on the same field
        {
          id: 'p-2', claim_id: 1, field_name: 'sum_insured',
          value: { kind: 'money', amount: 200, currency: 'INR' },
          source_type: 'document', source_document_type: 'endorsement',
          is_current: false, conflict_status: 'pending',
        },
      ],
    });
    const out = await getClaimWithProvenance(supabase, 1);
    expect(out.data_quality.conflicts).toBe(1);
    // 6/6 mandatory − 0.1 conflict penalty = 0.9
    expect(out.data_quality.score).toBeLessThan(1);
    expect(out.data_quality.score).toBeGreaterThanOrEqual(0.9);
  });

  it('throws on unknown claim', async () => {
    const supabase = mockSupabase({ claims: [] });
    await expect(getClaimWithProvenance(supabase, 999)).rejects.toThrow(/Claim not found/);
  });
});

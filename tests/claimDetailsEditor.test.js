// =============================================================================
// tests/claimDetailsEditor.test.js
// =============================================================================
// Pure-logic tests for the editable Registration tab on /claim-detail/[id].
//
// The component itself isn't rendered (no DOM in this repo's vitest setup);
// instead the behaviours that matter for correctness are exposed as pure
// helpers that can be exercised directly:
//
//   - initFormState(claim)      — copy editable columns off the claim row
//   - buildPutBody(curr, last)  — diff for the autosave PUT body
//   - SECTIONS / LOCKED_REGISTRATION_FIELDS / allEditableFieldKeys()
//
// Critical invariants these tests pin:
//   * Locked fields (ref_number, id, timestamps, registered_by) NEVER appear
//     in the PUT body.
//   * Transient _insurer_id never leaks through the PUT body.
//   * The 9 office FK columns (appointing/policy/fsr × id/name/address)
//     and insurer_name are editable here.
//   * Schema stays in sync between the registration wizard and the editor
//     because both import from the same SECTIONS export.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  SECTIONS,
  LOCKED_REGISTRATION_FIELDS,
  allEditableFieldKeys,
} from '../lib/claimRegistrationSections.js';
import {
  initFormState,
  buildPutBody,
} from '../lib/claimDetailsEditorState.js';

// Minimal but realistic claim row.
function sampleClaim() {
  return {
    id: 487,
    ref_number: 'UTCL-002/26-27',
    created_at: '2026-05-04T10:00:00Z',
    registered_at: '2026-05-04T10:30:00Z',
    registered_by: 'peeyush@nathani.in',
    company: 'NISLA',
    insurer_name: 'Tata AIG General Insurance Co. Ltd.',
    insurer_branch: 'Mumbai',
    dealing_officer_name: '',
    dealing_officer_email: '',
    dealing_officer_phone: '',
    appointing_office_id: 11,
    appointing_office_name: 'Mumbai HO',
    appointing_office_address: 'Fort, Mumbai, MH, 400001',
    policy_office_id: 12,
    policy_office_name: 'Pune RO',
    policy_office_address: 'Camp, Pune, MH, 411001',
    fsr_office_id: null,
    fsr_office_name: '',
    fsr_office_address: '',
    policy_number: '0865107728',
    policy_period_from: '2026-04-03',
    policy_period_to: '2027-04-02',
    sum_insured: 1250000000,
    policy_type: 'Marine Cargo Open Policy',
    insured_name: 'M/s Ultratech Cement Ltd.',
    insured_address: 'Andheri (E), Mumbai',
    insured_contact_phone: '',
    insured_contact_email: '',
    insured_gstin: '',
    lob: 'Marine Cargo',
    lob_subcategory: '',
    peril_type: '',
    cause_of_loss: '',
    date_loss: '2026-04-08',
    date_of_intimation: '2026-04-14',
    loss_location: 'Bareilly',
    loss_location_pin: '243004',
    loss_location_state: 'Uttar Pradesh',
    loss_location_district: 'Bareilly',
    estimated_loss_amount: 80000,
    gross_loss: null,
    complexity_tier: 'standard',
    is_catastrophe: false,
    fee_basis: 'irdai_scale',
    fee_amount: null,
    fee_notes: '',
    remark: '',
  };
}

// ============================================================================
// SECTIONS / LOCKED_REGISTRATION_FIELDS / allEditableFieldKeys
// ============================================================================

describe('SECTIONS', () => {
  it('exports the expected top-level sections in order', () => {
    expect(SECTIONS.map((s) => s.key)).toEqual([
      'insurer', 'policy', 'insured', 'loss', 'classification', 'fee', 'remark',
    ]);
  });

  it('every field has key + label + type', () => {
    for (const sec of SECTIONS) {
      for (const f of sec.fields) {
        expect(typeof f.key).toBe('string');
        expect(f.key.length).toBeGreaterThan(0);
        expect(typeof f.label).toBe('string');
        expect(typeof f.type).toBe('string');
      }
    }
  });

  it('every field type is one we know how to render', () => {
    const allowed = new Set(['text', 'email', 'tel', 'date', 'number', 'textarea', 'select', 'boolean', 'lob_subcategory']);
    for (const sec of SECTIONS) {
      for (const f of sec.fields) {
        expect(allowed.has(f.type)).toBe(true);
      }
    }
  });

  it('select fields declare their options array', () => {
    for (const sec of SECTIONS) {
      for (const f of sec.fields) {
        if (f.type === 'select') {
          expect(Array.isArray(f.options)).toBe(true);
          expect(f.options.length).toBeGreaterThan(0);
          // First option is the blank state.
          expect(f.options[0]).toBe('');
        }
      }
    }
  });
});

describe('LOCKED_REGISTRATION_FIELDS', () => {
  it('locks identity + audit fields', () => {
    expect(LOCKED_REGISTRATION_FIELDS).toEqual([
      'id', 'ref_number', 'created_at', 'registered_at', 'registered_by',
    ]);
  });

  it('is a frozen array (immutable contract)', () => {
    expect(Object.isFrozen(LOCKED_REGISTRATION_FIELDS)).toBe(true);
  });
});

describe('allEditableFieldKeys', () => {
  const keys = allEditableFieldKeys();

  it('includes insurer_name (owned by InsurerBlock, not by SECTIONS)', () => {
    expect(keys).toContain('insurer_name');
  });

  it('includes the 9 office columns from the 3-office picker', () => {
    for (const role of ['appointing', 'policy', 'fsr']) {
      expect(keys).toContain(`${role}_office_id`);
      expect(keys).toContain(`${role}_office_name`);
      expect(keys).toContain(`${role}_office_address`);
    }
  });

  it('includes every column declared in SECTIONS', () => {
    for (const sec of SECTIONS) {
      for (const f of sec.fields) {
        expect(keys).toContain(f.key);
      }
    }
  });

  it('NEVER includes any locked field', () => {
    for (const lk of LOCKED_REGISTRATION_FIELDS) {
      expect(keys).not.toContain(lk);
    }
  });

  it('returns no duplicates', () => {
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ============================================================================
// initFormState
// ============================================================================

describe('initFormState', () => {
  it('returns {} for null/undefined/non-object', () => {
    expect(initFormState(null)).toEqual({});
    expect(initFormState(undefined)).toEqual({});
    expect(initFormState('not an object')).toEqual({});
  });

  it('seeds _insurer_id to null', () => {
    const fs = initFormState(sampleClaim());
    expect(fs._insurer_id).toBeNull();
  });

  it('copies every editable column off the claim row', () => {
    const fs = initFormState(sampleClaim());
    expect(fs.insurer_name).toBe('Tata AIG General Insurance Co. Ltd.');
    expect(fs.policy_number).toBe('0865107728');
    expect(fs.appointing_office_id).toBe(11);
    expect(fs.fsr_office_id).toBeNull();
    expect(fs.lob).toBe('Marine Cargo');
    expect(fs.estimated_loss_amount).toBe(80000);
  });

  it('does NOT copy locked fields', () => {
    const fs = initFormState(sampleClaim());
    for (const k of LOCKED_REGISTRATION_FIELDS) {
      expect(fs[k]).toBeUndefined();
    }
  });

  it('preserves explicit nulls (so they reach the PUT body and clear stale data)', () => {
    const fs = initFormState({ ...sampleClaim(), gross_loss: null });
    expect('gross_loss' in fs).toBe(true);
    expect(fs.gross_loss).toBeNull();
  });

  it('omits keys that are not on the claim row at all', () => {
    const fs = initFormState({ id: 1, ref_number: 'X', insurer_name: 'A' });
    expect('policy_number' in fs).toBe(false);
    expect(fs.insurer_name).toBe('A');
  });
});

// ============================================================================
// buildPutBody — diff for the autosave PUT
// ============================================================================

describe('buildPutBody', () => {
  it('returns {} when nothing changed', () => {
    const seed = initFormState(sampleClaim());
    expect(buildPutBody(seed, seed)).toEqual({});
  });

  it('includes only the changed fields', () => {
    const seed = initFormState(sampleClaim());
    const next = { ...seed, dealing_officer_email: 'rakesh@adityabirla.com' };
    expect(buildPutBody(next, seed)).toEqual({
      dealing_officer_email: 'rakesh@adityabirla.com',
    });
  });

  it('NEVER includes locked fields, even if they differ', () => {
    const seed = initFormState(sampleClaim());
    const tampered = { ...seed, ref_number: 'HACK', id: 999, registered_by: 'bad@x.in' };
    const body = buildPutBody(tampered, seed);
    for (const k of LOCKED_REGISTRATION_FIELDS) {
      expect(k in body).toBe(false);
    }
  });

  it('NEVER includes transient _-prefixed flags (_insurer_id is local-only)', () => {
    const seed = initFormState(sampleClaim());
    const next = { ...seed, _insurer_id: 99 };
    expect(buildPutBody(next, seed)).toEqual({});
  });

  it('treats numeric and string forms of the same number as equal (no spurious diff)', () => {
    const seed = initFormState({ ...sampleClaim(), sum_insured: 1250000000 });
    const next = { ...seed, sum_insured: '1250000000' };
    expect(buildPutBody(next, seed)).toEqual({});
  });

  it('treats both null and undefined as no-change vs each other', () => {
    const seed = { ...initFormState(sampleClaim()), peril_type: null };
    const next = { ...seed, peril_type: undefined };
    expect(buildPutBody(next, seed)).toEqual({});
  });

  it('captures a clear → null change (so server can clear a stale value)', () => {
    const seed = initFormState(sampleClaim());
    const next = { ...seed, dealing_officer_name: null };
    // dealing_officer_name was '' in the seed, which sameValue treats as
    // different from null — this clears the stale empty string. The dual-
    // write decision engine on the server handles the policy.
    const body = buildPutBody(next, seed);
    expect(body.dealing_officer_name).toBeNull();
  });

  it('captures a 3-office picker change (insurer + offices simultaneously)', () => {
    const seed = initFormState(sampleClaim());
    const next = {
      ...seed,
      insurer_name: 'New India Assurance',
      appointing_office_id: null,
      appointing_office_name: '',
      appointing_office_address: '',
      policy_office_id: null,
      policy_office_name: '',
      policy_office_address: '',
      fsr_office_id: 99,
      fsr_office_name: 'NIA Mumbai HO',
      fsr_office_address: 'Cooperage Rd, Mumbai 400001',
    };
    const body = buildPutBody(next, seed);
    expect(body.insurer_name).toBe('New India Assurance');
    expect(body.appointing_office_id).toBeNull();
    expect(body.fsr_office_id).toBe(99);
    expect(body.fsr_office_name).toBe('NIA Mumbai HO');
  });

  it('handles non-object inputs gracefully', () => {
    expect(buildPutBody(null, null)).toEqual({});
    expect(buildPutBody(undefined, {})).toEqual({});
    expect(buildPutBody({}, undefined)).toEqual({});
  });
});

// ============================================================================
// Cross-check: schema between the wizard and the editor
// ============================================================================

describe('schema sync between /claim-registration and /claim-detail Registration tab', () => {
  it('SECTIONS is the single source of truth (both pages import from lib/claimRegistrationSections)', () => {
    // This is a structural test — the import location is what guarantees the
    // sync. If anyone re-introduces an inline SECTIONS in either file, the
    // editor will silently drift from the wizard. Catch by enumerating the
    // shape contract here so a future PR diff makes the drift obvious.
    expect(SECTIONS.length).toBe(7);
    expect(SECTIONS[0].title).toBe('Insurer');
    expect(SECTIONS[3].title).toBe('Loss');
    // The wizard uses 'mandatory' to gate its Submit button. The editor
    // doesn't gate (autosave is per-field), but it must show the asterisk
    // identically — so we keep the contract.
    const mandatoryKeys = SECTIONS.flatMap((s) => s.fields).filter((f) => f.mandatory).map((f) => f.key);
    expect(mandatoryKeys).toEqual([
      'policy_number', 'policy_period_from', 'policy_period_to', 'sum_insured',
      'insured_name',
      'lob', 'date_loss', 'date_of_intimation', 'loss_location', 'loss_location_pin',
    ]);
  });
});

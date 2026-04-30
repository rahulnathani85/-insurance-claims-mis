// =============================================================================
// tests/ila.test.js
// =============================================================================
// Unit tests for lib/ila/* — checklist defaults, draft sanitiser, TAT
// compliance + countdown helpers.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  defaultChecklistFor,
  sortChecklist,
  PRIORITY_ORDER,
  CHECKLIST_BY_LOB,
  sanitiseDraftPayload,
  sanitiseChecklist,
  computeTatCompliance,
  tatCountdown,
  ADMISSIBILITY_OPTIONS,
  DRAFT_STATUSES,
} from '../lib/ila/index.js';
import { renderIlaHtml } from '../lib/ila/templates.js';

describe('defaultChecklistFor', () => {
  it('returns a Fire-specific checklist with high-priority items', () => {
    const items = defaultChecklistFor('Fire');
    expect(items.length).toBeGreaterThan(3);
    expect(items.some((i) => /policy schedule/i.test(i.type))).toBe(true);
    expect(items.some((i) => /FIR/i.test(i.type))).toBe(true);
    items.forEach((i) => expect(i.status).toBe('pending'));
  });

  it('falls back to Miscellaneous on unknown LOB', () => {
    expect(defaultChecklistFor('NotALob')).toEqual(defaultChecklistFor('Miscellaneous'));
  });

  it('every LOB has a checklist', () => {
    for (const lob of Object.keys(CHECKLIST_BY_LOB)) {
      expect(defaultChecklistFor(lob).length).toBeGreaterThan(0);
    }
  });

  it('returns fresh array — no shared references', () => {
    const a = defaultChecklistFor('Fire');
    const b = defaultChecklistFor('Fire');
    a[0].status = 'received';
    expect(b[0].status).toBe('pending');
  });
});

describe('sortChecklist', () => {
  it('orders high before medium before low', () => {
    const out = sortChecklist([
      { type: 'A', priority: 'low' },
      { type: 'B', priority: 'high' },
      { type: 'C', priority: 'medium' },
    ]);
    expect(out.map((i) => i.priority)).toEqual(['high', 'medium', 'low']);
  });

  it('alphabetises within the same priority', () => {
    const out = sortChecklist([
      { type: 'Banana', priority: 'high' },
      { type: 'Apple', priority: 'high' },
    ]);
    expect(out[0].type).toBe('Apple');
  });

  it('PRIORITY_ORDER constant is exposed', () => {
    expect(PRIORITY_ORDER.high).toBe(0);
    expect(PRIORITY_ORDER.low).toBe(2);
  });
});

describe('sanitiseChecklist', () => {
  it('strips empty rows + clamps priority/status', () => {
    const out = sanitiseChecklist([
      { type: 'Policy', priority: 'high', status: 'pending' },
      { type: '   ', priority: 'high' },                 // empty after trim — skip
      null,                                              // skip
      { type: 'Estimate', priority: 'wrong', status: 'oops' }, // clamp
      { reason: 'no type' },                             // skip (no type)
    ]);
    expect(out.length).toBe(2);
    expect(out[0]).toMatchObject({ type: 'Policy', priority: 'high', status: 'pending' });
    expect(out[1].priority).toBe('medium');
    expect(out[1].status).toBe('pending');
  });

  it('returns [] on non-array', () => {
    expect(sanitiseChecklist(null)).toEqual([]);
    expect(sanitiseChecklist('string')).toEqual([]);
  });
});

describe('sanitiseDraftPayload', () => {
  it('trims string sections', () => {
    const out = sanitiseDraftPayload({ preliminary_view: '  hello  ' }, { skipUndefined: true });
    expect(out.preliminary_view).toBe('hello');
  });

  it('rejects unknown admissibility opinion', () => {
    expect(() => sanitiseDraftPayload({ admissibility_opinion: 'maybe' })).toThrow(/admissibility/);
  });

  it('accepts every spec admissibility value', () => {
    for (const opt of ADMISSIBILITY_OPTIONS) {
      const out = sanitiseDraftPayload({ admissibility_opinion: opt.value });
      expect(out.admissibility_opinion).toBe(opt.value);
    }
  });

  it('rejects unknown status', () => {
    expect(() => sanitiseDraftPayload({ status: 'pending' })).toThrow(/status/);
  });

  it('accepts every spec draft status', () => {
    for (const s of DRAFT_STATUSES) {
      const out = sanitiseDraftPayload({ status: s });
      expect(out.status).toBe(s);
    }
  });

  it('coerces preliminary_estimate to number or null', () => {
    expect(sanitiseDraftPayload({ preliminary_estimate: '50000' }).preliminary_estimate).toBe(50000);
    expect(sanitiseDraftPayload({ preliminary_estimate: 'abc' }).preliminary_estimate).toBeNull();
    expect(sanitiseDraftPayload({ preliminary_estimate: -10 }).preliminary_estimate).toBeNull();
  });

  it('passes documents_required through sanitiser', () => {
    const out = sanitiseDraftPayload({
      documents_required: [{ type: 'Policy', priority: 'wrong' }],
    });
    expect(out.documents_required[0].priority).toBe('medium');
  });
});

describe('computeTatCompliance', () => {
  const due = new Date('2026-04-30T15:00:00Z');

  it('compliant when submitted before due', () => {
    const out = computeTatCompliance(new Date('2026-04-30T14:59:00Z'), due);
    expect(out.compliant).toBe(true);
    expect(out.breach_hours).toBe(0);
  });

  it('compliant exactly at due time', () => {
    const out = computeTatCompliance(due, due);
    expect(out.compliant).toBe(true);
  });

  it('non-compliant + breach_hours when past due', () => {
    const out = computeTatCompliance(new Date('2026-05-01T15:00:00Z'), due);
    expect(out.compliant).toBe(false);
    expect(out.breach_hours).toBe(24);
  });

  it('treats missing ila_due_at as compliant', () => {
    expect(computeTatCompliance(new Date(), null).compliant).toBe(true);
  });

  it('handles invalid input safely', () => {
    expect(computeTatCompliance('not a date', 'also not')).toEqual({ compliant: true, breach_hours: 0 });
  });
});

describe('tatCountdown', () => {
  const TODAY = new Date('2026-04-30T00:00:00Z');

  it('returns null when ila_due_at missing', () => {
    expect(tatCountdown(null, TODAY)).toBeNull();
    expect(tatCountdown(undefined, TODAY)).toBeNull();
  });

  it('green when >24h remaining', () => {
    const due = new Date('2026-05-02T00:00:00Z');
    const out = tatCountdown(due, TODAY);
    expect(out.severity).toBe('green');
    expect(out.label).toMatch(/left/);
  });

  it('amber within 24h', () => {
    const due = new Date('2026-04-30T20:00:00Z');
    const out = tatCountdown(due, TODAY);
    expect(out.severity).toBe('amber');
  });

  it('red within 6h', () => {
    const due = new Date('2026-04-30T05:00:00Z');
    const out = tatCountdown(due, TODAY);
    expect(out.severity).toBe('red');
    expect(out.label).toMatch(/URGENT/);
  });

  it('breach when past due', () => {
    const due = new Date('2026-04-29T20:00:00Z');
    const out = tatCountdown(due, TODAY);
    expect(out.severity).toBe('breach');
    expect(out.label).toMatch(/OVERDUE/);
  });

  it('formats days when >=24h', () => {
    const due = new Date('2026-05-05T00:00:00Z');
    const out = tatCountdown(due, TODAY);
    expect(out.label).toMatch(/\d+d \d+h/);
  });
});

describe('renderIlaHtml', () => {
  const baseClaim = {
    id: 1,
    ref_number: '4053/26-27/Fire',
    insurer_name: 'New India Assurance',
    insured_name: 'Acme Industries',
    policy_number: 'POL-1',
    lob: 'Fire',
    lob_subcategory: 'SFSP (Standard Fire & Special Perils)',
    date_loss: '2026-04-29',
    date_of_intimation: '2026-04-29',
    registered_at: '2026-04-30T03:00:00Z',
    loss_location: 'Mumbai',
    company: 'NISLA',
  };
  const baseDraft = {
    version: 1,
    preliminary_view: 'Fire damage to godown.',
    admissibility_opinion: 'admissible_with_conditions',
    admissibility_reasoning: 'Subject to policy schedule confirmation.',
    preliminary_estimate: 5000000,
    estimate_basis: 'Insured-stated quantum.',
    documents_required: [
      { type: 'Policy schedule', priority: 'high', reason: 'Coverage', status: 'pending' },
      { type: 'FIR', priority: 'high', reason: 'Cause', status: 'pending' },
    ],
    next_steps: 'Schedule site inspection.',
    expected_fsr_date: '2026-05-30',
    observations: '',
    cover_data: {},
  };
  const signer = {
    name: 'Jane Doe',
    email: 'jane@nisla.in',
    license_number: 'IRDAI/CORP/SLA-200025',
    license_category: 'A',
  };

  it('renders a complete HTML doc with the claim ref', () => {
    const html = renderIlaHtml({ claim: baseClaim, draft: baseDraft, signer });
    expect(html).toMatch(/<!DOCTYPE html>/);
    expect(html).toContain('4053/26-27/Fire');
    expect(html).toContain('New India Assurance');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('IRDAI/CORP/SLA-200025');
    expect(html).toContain('SFSP (Standard Fire &amp; Special Perils)');
  });

  it('escapes HTML in user content', () => {
    const draft = { ...baseDraft, preliminary_view: '<script>alert(1)</script>' };
    const html = renderIlaHtml({ claim: baseClaim, draft, signer });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('uses Acuere letterhead when company is Acuere', () => {
    const html = renderIlaHtml({ claim: baseClaim, draft: baseDraft, signer, company: 'Acuere' });
    expect(html).toContain('Acuere Surveyors');
    expect(html).toContain('IRDAI/IND/SLA-85225');
  });

  it('formats currency in INR', () => {
    const html = renderIlaHtml({ claim: baseClaim, draft: baseDraft, signer });
    // INR formatter outputs "₹50,00,000" (Indian numbering) for 5_000_000.
    expect(html).toMatch(/₹\s*50,00,000|₹50,00,000/);
  });

  it('handles missing optional fields gracefully', () => {
    const sparseDraft = {
      version: 1,
      preliminary_view: 'x',
      admissibility_opinion: 'needs_investigation',
      next_steps: 'y',
      documents_required: [],
      expected_fsr_date: '2026-05-30',
    };
    const html = renderIlaHtml({ claim: baseClaim, draft: sparseDraft, signer });
    expect(html).toContain('—');
    expect(html).toContain('None at this stage.');
  });
});

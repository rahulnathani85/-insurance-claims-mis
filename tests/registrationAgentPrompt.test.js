// =============================================================================
// tests/registrationAgentPrompt.test.js
// =============================================================================
// Unit tests for lib/comms/prompts/registrationAgentPrompt.js
//   - buildRegistrationPrompt: structural assertions on the produced prompt
//   - parseRegistrationJson:   happy path + 4 malformed-input cases
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  REGISTRATION_AGENT_SCHEMA,
  CRITICAL_FIELDS,
  buildRegistrationPrompt,
  parseRegistrationJson,
  formatOfficesForPrompt,
} from '../lib/comms/prompts/registrationAgentPrompt.js';

describe('REGISTRATION_AGENT_SCHEMA', () => {
  it('contains the form-aligned fields the registration page expects', () => {
    const keys = REGISTRATION_AGENT_SCHEMA.map((f) => f.key);
    // Must-have form-mandatory fields:
    for (const k of [
      'insurer_name', 'policy_number', 'policy_period_from', 'policy_period_to',
      'sum_insured', 'insured_name', 'lob', 'date_loss', 'date_of_intimation',
      'loss_location', 'loss_location_pin',
    ]) {
      expect(keys).toContain(k);
    }
    // Must-have non-mandatory but valuable:
    for (const k of [
      'insurer_branch', 'dealing_officer_name', 'dealing_officer_email',
      'dealing_officer_phone', 'peril_type', 'cause_of_loss',
    ]) {
      expect(keys).toContain(k);
    }
  });

  it('does NOT include surveyor-judgment fields', () => {
    const keys = REGISTRATION_AGENT_SCHEMA.map((f) => f.key);
    for (const k of [
      'ref_number', 'complexity_tier', 'is_catastrophe',
      'fee_basis', 'fee_amount', 'fee_notes', 'remark',
      'loss_location_lat', 'loss_location_lng',
    ]) {
      expect(keys).not.toContain(k);
    }
    // lob_subcategory IS now extracted by the agent (was previously a
    // surveyor-only pick); it must be present and constrained via the
    // per-LOB option list injected into the user message.
    expect(keys).toContain('lob_subcategory');
  });

  it('marks the spec-listed critical fields', () => {
    expect(CRITICAL_FIELDS).toEqual(expect.arrayContaining([
      'policy_number', 'insured_name', 'date_loss',
      'cause_of_loss', 'insurer_name', 'loss_location',
    ]));
  });

  it('declares the 3 office_id fields the agent picks from the insurer office table', () => {
    const byKey = Object.fromEntries(REGISTRATION_AGENT_SCHEMA.map((f) => [f.key, f]));
    for (const key of ['appointing_office_id', 'policy_office_id', 'fsr_office_id']) {
      expect(byKey).toHaveProperty(key);
      expect(byKey[key].type).toBe('number');
      expect(byKey[key].required).toBe(false);
      // Hint must steer the agent to PICK FROM THE LIST and not invent IDs.
      expect(byKey[key].hint).toMatch(/list|pick from|do not guess/i);
    }
  });
});

// ============================================================================
// formatOfficesForPrompt — table generator for the agent's office list
// ============================================================================

describe('formatOfficesForPrompt', () => {
  const sample = [
    { id: 47, office_code: 'HO',  name: 'Head Office',                  city: 'Mumbai',    state: 'MH', address: '5th Floor, ICICI Towers, BKC' },
    { id: 48, office_code: 'RO',  name: 'Mumbai Regional Office',       city: 'Mumbai',    state: 'MH', address: 'Andheri East' },
    { id: 49, office_code: 'RO',  name: 'Ahmedabad Regional Office',    city: 'Ahmedabad', state: 'GJ', address: 'Navrangpura' },
  ];

  it('returns a markdown-style table with header, separator, and one row per office', () => {
    const out = formatOfficesForPrompt(sample);
    const lines = out.split('\n');
    expect(lines.length).toBe(2 + sample.length);             // header + separator + rows
    expect(lines[0]).toMatch(/id\b.*\bcode\b.*\bname\b.*\bcity\b.*\bstate\b/);
    expect(lines[1]).toMatch(/^\|----/);                       // separator row
    for (const o of sample) {
      expect(out).toContain(String(o.id));
      expect(out).toContain(o.office_code);
      expect(out).toContain(o.name);
    }
  });

  it('returns "" for empty / non-array input', () => {
    expect(formatOfficesForPrompt([])).toBe('');
    expect(formatOfficesForPrompt(null)).toBe('');
    expect(formatOfficesForPrompt(undefined)).toBe('');
    expect(formatOfficesForPrompt('not an array')).toBe('');
  });

  it('truncates long names + addresses without throwing', () => {
    const long = formatOfficesForPrompt([
      { id: 1, office_code: 'BO', name: 'A'.repeat(200), city: 'X', state: 'YY', address: 'B'.repeat(500) },
    ]);
    expect(long).toContain('AAAAA');
    // String length is bounded — no exception, no runaway row.
    expect(long.split('\n').length).toBe(3);
  });
});

// ============================================================================
// buildRegistrationPrompt — office list integration
// ============================================================================

describe('buildRegistrationPrompt — insurerOffices integration', () => {
  const baseClaim = { id: 487, ref_number: 'UTCL-002/26-27', lob: 'Marine Cargo', company: 'NISLA', insurer_name: 'HDFC ERGO General Insurance Co. Ltd.' };
  const offices = [
    { id: 47, office_code: 'HO', name: 'Head Office',            city: 'Mumbai',    state: 'MH', address: 'BKC' },
    { id: 48, office_code: 'RO', name: 'Mumbai Regional Office', city: 'Mumbai',    state: 'MH', address: 'Andheri' },
    { id: 49, office_code: 'RO', name: 'Ahmedabad Regional',     city: 'Ahmedabad', state: 'GJ', address: 'Navrangpura' },
  ];

  it('embeds the offices table when a non-empty insurerOffices array is supplied', () => {
    const { userMessage } = buildRegistrationPrompt({
      claim: baseClaim,
      insurerOffices: offices,
    });
    expect(userMessage).toContain('Available offices for this insurer');
    expect(userMessage).toContain('HDFC ERGO');
    expect(userMessage).toContain('Mumbai Regional Office');
    expect(userMessage).toContain('Ahmedabad Regional');
    // The table header must be present with a recognisable column row.
    expect(userMessage).toMatch(/\| id\s+\| code\s+\| name/);
  });

  it('omits the offices section when insurerOffices is empty / missing', () => {
    const { userMessage: a } = buildRegistrationPrompt({ claim: baseClaim, insurerOffices: [] });
    const { userMessage: b } = buildRegistrationPrompt({ claim: baseClaim });
    expect(a).not.toContain('Available offices for this insurer');
    expect(b).not.toContain('Available offices for this insurer');
  });

  it("system prompt includes the office-role definitions and the matching policy", () => {
    const { systemPrompt } = buildRegistrationPrompt({ claim: baseClaim, insurerOffices: offices });
    // Role definitions present.
    expect(systemPrompt).toMatch(/appointing_office_id/);
    expect(systemPrompt).toMatch(/policy_office_id/);
    expect(systemPrompt).toMatch(/fsr_office_id/);
    // Hierarchy glossary present.
    expect(systemPrompt).toMatch(/\bHO\b.*Head Office/);
    expect(systemPrompt).toMatch(/\bRO\b.*Regional Office/);
    expect(systemPrompt).toMatch(/\bLCBO\b/);
    // Matching-policy rules present.
    expect(systemPrompt).toMatch(/MRO|Mumbai Regional Office|Mumbai R\.O\./);
    expect(systemPrompt).toMatch(/HO > RO > ZO/);
    expect(systemPrompt).toMatch(/Do NOT match across insurers|not in the supplied table/i);
  });

  it("system prompt forbids hallucinating IDs", () => {
    const { systemPrompt } = buildRegistrationPrompt({ claim: baseClaim, insurerOffices: offices });
    expect(systemPrompt).toMatch(/NEVER invent an id|NEVER pick an id from a different insurer|NEVER guess/i);
  });
});

describe('buildRegistrationPrompt', () => {
  const baseInput = {
    claim: { id: 464, ref_number: 'INTAKE/NISLA/3dae8108', lob: 'Motor', company: 'NISLA' },
    intimation: {
      from_address: 'sahil.tandon@nic.co.in',
      subject: 'GCH-26-45 || New Claim Intimation || Vehicle DD 01 C 9106',
      received_at: '2026-04-28T10:30:00Z',
      body_plain: 'Vehicle - DD 01 C 9106\nDOL - 24/04/2026\nLoss location - Nashik, MH\nInsured - Chifu Agritech Pvt Ltd\nPolicy No. - 460708212610000001',
    },
    attachments: [{ filename: 'Insurance_Policy.pdf', mime_type: 'application/pdf' }],
    ocrText: 'NATIONAL INSURANCE COMPANY LIMITED ... Sum Insured Rs. 5,00,00,000 ... Period 04/04/2026 to 03/04/2027',
    existingExtraction: { policy_no: '460708212610000001', insured_name: 'Chifu Agritech Pvt Ltd' },
  };

  it('returns systemPrompt + userMessage', () => {
    const out = buildRegistrationPrompt(baseInput);
    expect(out).toHaveProperty('systemPrompt');
    expect(out).toHaveProperty('userMessage');
    expect(typeof out.systemPrompt).toBe('string');
    expect(typeof out.userMessage).toBe('string');
  });

  it('includes every schema field name in the system prompt', () => {
    const { systemPrompt } = buildRegistrationPrompt(baseInput);
    for (const f of REGISTRATION_AGENT_SCHEMA) {
      expect(systemPrompt).toContain(f.key);
    }
  });

  it('embeds the intimation email body in the user message', () => {
    const { userMessage } = buildRegistrationPrompt(baseInput);
    expect(userMessage).toContain('Chifu Agritech');
    expect(userMessage).toContain('460708212610000001');
  });

  it('embeds the OCR text', () => {
    const { userMessage } = buildRegistrationPrompt(baseInput);
    expect(userMessage).toContain('NATIONAL INSURANCE COMPANY LIMITED');
  });

  it('embeds the existing JSON when provided', () => {
    const { userMessage } = buildRegistrationPrompt(baseInput);
    expect(userMessage).toContain('existing_json');
  });

  it('tolerates missing intimation / attachments / existingExtraction', () => {
    const out = buildRegistrationPrompt({ claim: { lob: 'Fire' } });
    expect(out.systemPrompt).toBeTruthy();
    expect(out.userMessage).toContain('Fire');
  });

  it('manual-claim shape: only OCR text + claim_context, no intimation_email', () => {
    // Manual claims have no intake_message_id, so no email body to feed in.
    // The prompt should still produce a valid input doc, with the
    // intimation_email field set to null and the rest of the structure
    // intact so the LLM relies on attachments_ocr_text.
    const out = buildRegistrationPrompt({
      claim: { id: 480, ref_number: 'MANUAL/NISLA/aabbccdd', lob: 'Fire', company: 'NISLA' },
      intimation: null,
      attachments: [{ filename: 'policy.pdf', mime_type: 'application/pdf' }],
      ocrText: 'Sum Insured Rs. 10,00,000\nInsured: Acme Industries\nPolicy No. POL-9876',
    });
    expect(out.userMessage).toContain('"intimation_email": null');
    expect(out.userMessage).toContain('Sum Insured');
    expect(out.userMessage).toContain('MANUAL/NISLA/aabbccdd');
  });

  it('truncates very long bodies and OCR text without throwing', () => {
    const huge = 'x'.repeat(100_000);
    const out = buildRegistrationPrompt({
      claim: { lob: 'Fire' },
      intimation: { body_plain: huge, from_address: 'x@y.z', subject: 's' },
      ocrText: huge,
    });
    expect(out.userMessage).toContain('truncated');
  });
});

describe('parseRegistrationJson', () => {
  const happy = JSON.stringify({
    fields: {
      policy_number: { value: '460708212610000001', confidence: 0.98, source: 'cross_verified', raw_snippet: 'Policy No. - 460708212610000001' },
      insured_name:  { value: 'Chifu Agritech Pvt Ltd', confidence: 0.95, source: 'email', raw_snippet: 'Insured - Chifu Agritech Pvt Ltd' },
      date_loss:     { value: '24-04-2026', confidence: 0.92, source: 'email', raw_snippet: 'DOL - 24/04/2026' },
      sum_insured:   { value: 50000000, confidence: 0.88, source: 'ocr_Insurance_Policy.pdf', raw_snippet: 'Sum Insured Rs. 5,00,00,000' },
    },
    conflicts: [],
    missing_critical_fields: ['cause_of_loss'],
    extraction_notes: 'cause_of_loss not stated in any source',
  });

  it('parses well-formed rich JSON', () => {
    const out = parseRegistrationJson(happy);
    expect(out.fields.policy_number.value).toBe('460708212610000001');
    expect(out.fields.policy_number.confidence).toBe(0.98);
    expect(out.fields.policy_number.source).toBe('cross_verified');
    expect(out.fields.policy_number.raw_snippet).toMatch(/Policy No/);
    expect(out.missing_critical_fields).toEqual(['cause_of_loss']);
    expect(out.conflicts).toEqual([]);
  });

  it('strips markdown code fences', () => {
    const wrapped = '```json\n' + happy + '\n```';
    const out = parseRegistrationJson(wrapped);
    expect(out.fields.insured_name.value).toBe('Chifu Agritech Pvt Ltd');
  });

  it('clamps confidence to [0, 1] and coerces non-numeric to null', () => {
    const dirty = JSON.stringify({
      fields: {
        a: { value: 'X', confidence: 1.5,  source: 'email', raw_snippet: '' },
        b: { value: 'Y', confidence: -0.3, source: 'email', raw_snippet: '' },
        c: { value: 'Z', confidence: 'high', source: 'email', raw_snippet: '' },
      },
    });
    const out = parseRegistrationJson(dirty);
    expect(out.fields.a.confidence).toBe(1);
    expect(out.fields.b.confidence).toBe(0);
    expect(out.fields.c.confidence).toBe(null);
  });

  it('throws on non-object root', () => {
    expect(() => parseRegistrationJson('[1,2,3]')).toThrow(/not an object/);
  });

  it('throws on missing fields object', () => {
    expect(() => parseRegistrationJson('{"conflicts":[]}')).toThrow(/missing.*fields/);
  });

  it('throws on completely invalid JSON', () => {
    expect(() => parseRegistrationJson('not json at all')).toThrow();
  });

  it('throws on empty input', () => {
    expect(() => parseRegistrationJson('')).toThrow(/Empty/);
    expect(() => parseRegistrationJson(null)).toThrow(/Empty/);
  });

  it('skips field entries that are not objects', () => {
    const mixed = JSON.stringify({
      fields: {
        ok: { value: 'x', confidence: 0.9, source: 'email', raw_snippet: '' },
        bad_string: 'just a string',
        bad_array: [1, 2, 3],
      },
    });
    const out = parseRegistrationJson(mixed);
    expect(Object.keys(out.fields)).toEqual(['ok']);
  });
});

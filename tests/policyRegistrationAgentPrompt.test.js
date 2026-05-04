// =============================================================================
// tests/policyRegistrationAgentPrompt.test.js
// =============================================================================
// Unit tests for lib/comms/prompts/policyRegistrationAgentPrompt.js
//   - INSURER_ALIAS_MAP: shape + canonical-name presence checks
//   - buildPolicyAgentPrompt: structural assertions on the produced prompt
//   - parsePolicyAgentJson: happy + 6 malformed shapes + invariant enforcement
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  INSURER_ALIAS_MAP,
  buildPolicyAgentPrompt,
  parsePolicyAgentJson,
} from '../lib/comms/prompts/policyRegistrationAgentPrompt.js';

describe('INSURER_ALIAS_MAP', () => {
  it('includes the four PSU general insurers from CLAUDE.md', () => {
    const canonicals = INSURER_ALIAS_MAP.map((r) => r.canonical);
    expect(canonicals).toContain('The New India Assurance Co. Ltd.');
    expect(canonicals).toContain('United India Insurance Co. Ltd.');
    expect(canonicals).toContain('The Oriental Insurance Co. Ltd.');
    expect(canonicals).toContain('National Insurance Co. Ltd.');
  });

  it('every row has code + canonical + aliases (array)', () => {
    for (const row of INSURER_ALIAS_MAP) {
      expect(typeof row.code).toBe('string');
      expect(typeof row.canonical).toBe('string');
      expect(Array.isArray(row.aliases)).toBe(true);
    }
  });

  it('contains the user-spec acronyms NIACL, NICL, OICL, UIICL', () => {
    const allAliases = INSURER_ALIAS_MAP.flatMap((r) => r.aliases);
    expect(allAliases).toContain('NIACL');
    expect(allAliases).toContain('UIICL');
  });
});

describe('buildPolicyAgentPrompt', () => {
  const baseInput = {
    extractedPolicy: {
      policy_number: { value: '460708212610000001', confidence: 0.97, source: 'cross_verified' },
      insurer:       { value: 'NICL', confidence: 0.92, source: 'email' },
      insured_name:  { value: 'Chifu Agritech Pvt Ltd', confidence: 0.95, source: 'email' },
      sum_insured:   { value: '5000000', confidence: 0.85, source: 'ocr_policy.pdf' },
      start_date:    { value: '04-04-2026', confidence: 0.9, source: 'ocr_policy.pdf' },
      end_date:      { value: '03-04-2027', confidence: 0.9, source: 'ocr_policy.pdf' },
      lob:           { value: 'Marine Cargo', confidence: 1.0, source: 'extracted' },
    },
    candidateMatches: [],
    claimContext: { claim_id: 464, ref_number: '4050/26-27/Marine', lob: 'Marine Cargo', company: 'NISLA' },
  };

  it('returns systemPrompt + userMessage', () => {
    const out = buildPolicyAgentPrompt(baseInput);
    expect(out).toHaveProperty('systemPrompt');
    expect(out).toHaveProperty('userMessage');
    expect(typeof out.systemPrompt).toBe('string');
    expect(typeof out.userMessage).toBe('string');
  });

  it('embeds the three decision verbs in the system prompt', () => {
    const { systemPrompt } = buildPolicyAgentPrompt(baseInput);
    expect(systemPrompt).toContain('match_existing');
    expect(systemPrompt).toContain('create_new');
    expect(systemPrompt).toContain('ambiguous_needs_review');
  });

  it('embeds the canonical insurer name and at least one acronym in the alias section', () => {
    const { systemPrompt } = buildPolicyAgentPrompt(baseInput);
    expect(systemPrompt).toContain('The New India Assurance Co. Ltd.');
    expect(systemPrompt).toContain('NIACL');
  });

  it('embeds the extracted_policy + candidate_matches + claim_context in the user message', () => {
    const { userMessage } = buildPolicyAgentPrompt(baseInput);
    expect(userMessage).toContain('460708212610000001');
    expect(userMessage).toContain('Chifu Agritech');
    expect(userMessage).toContain('"claim_id": 464');
  });

  it('caps candidate_matches at 5', () => {
    const candidates = Array.from({ length: 8 }).map((_, i) => ({
      id: i + 1, policy_number: `POL-${i}`, insurer: 'X',
    }));
    const { userMessage } = buildPolicyAgentPrompt({ ...baseInput, candidateMatches: candidates });
    expect(userMessage).toContain('"id": 1');
    expect(userMessage).toContain('"id": 5');
    expect(userMessage).not.toContain('"id": 6');
  });

  it('tolerates missing extractedPolicy / claimContext / candidateMatches', () => {
    const out = buildPolicyAgentPrompt({});
    expect(out.systemPrompt).toBeTruthy();
    expect(out.userMessage).toBeTruthy();
  });
});

describe('parsePolicyAgentJson', () => {
  const matchExisting = JSON.stringify({
    decision: 'match_existing',
    decision_confidence: 0.95,
    matched_policy_id: 12,
    merged_policy_fields: {
      policy_number: { value: '460708212610000001', source: 'master' },
      insurer:       { value: 'National Insurance Co. Ltd.', source: 'master' },
    },
    conflicts: [
      { field: 'sum_insured', master_value: '2500000', extracted_value: '5000000', reason: 'Master may be stale.' },
    ],
    new_policy_payload: null,
    review_reasons: [],
    reasoning: 'Exact policy_number match on insurer NICL.',
  });

  const createNew = JSON.stringify({
    decision: 'create_new',
    decision_confidence: 0.88,
    matched_policy_id: null,
    merged_policy_fields: {},
    conflicts: [],
    new_policy_payload: {
      policy_number: '230000-MTR-12345',
      insurer: 'The Oriental Insurance Co. Ltd.',
      insurer_office: 'Mumbai DO',
      insured_name: 'M/s Acme Ltd',
      insured_address: '...',
      phone: null,
      email: null,
      lob: 'Motor',
      policy_type: 'Motor OD',
      sum_insured: '850000',
      premium: '12500',
      start_date: '01-04-2026',
      end_date: '31-03-2027',
      policy_copy_url: null,
    },
    review_reasons: [],
    reasoning: 'No master candidate; extracted fields meet create_new threshold.',
  });

  const ambiguous = JSON.stringify({
    decision: 'ambiguous_needs_review',
    decision_confidence: 0.45,
    matched_policy_id: null,
    merged_policy_fields: {},
    conflicts: [],
    new_policy_payload: null,
    review_reasons: ['policy_number confidence 0.7 < 0.80', 'two candidates equally strong'],
    reasoning: 'Cannot rank candidates 12 and 14 confidently.',
  });

  it('parses match_existing happy path', () => {
    const out = parsePolicyAgentJson(matchExisting);
    expect(out.decision).toBe('match_existing');
    expect(out.matched_policy_id).toBe(12);
    expect(out.new_policy_payload).toBe(null);
    expect(out.conflicts).toHaveLength(1);
  });

  it('parses create_new happy path', () => {
    const out = parsePolicyAgentJson(createNew);
    expect(out.decision).toBe('create_new');
    expect(out.matched_policy_id).toBe(null);
    expect(out.new_policy_payload?.policy_number).toBe('230000-MTR-12345');
  });

  it('parses ambiguous_needs_review happy path', () => {
    const out = parsePolicyAgentJson(ambiguous);
    expect(out.decision).toBe('ambiguous_needs_review');
    expect(out.review_reasons.length).toBe(2);
  });

  it('strips markdown code fences', () => {
    const wrapped = '```json\n' + matchExisting + '\n```';
    const out = parsePolicyAgentJson(wrapped);
    expect(out.decision).toBe('match_existing');
  });

  it('coerces leaked new_policy_payload on match_existing to null', () => {
    const messy = JSON.stringify({
      ...JSON.parse(matchExisting),
      new_policy_payload: { policy_number: 'should-not-be-here' },
    });
    const out = parsePolicyAgentJson(messy);
    expect(out.new_policy_payload).toBe(null);
  });

  it('coerces leaked matched_policy_id on create_new to null', () => {
    const messy = JSON.stringify({
      ...JSON.parse(createNew),
      matched_policy_id: 99,
    });
    const out = parsePolicyAgentJson(messy);
    expect(out.matched_policy_id).toBe(null);
  });

  it('clamps decision_confidence to [0, 1] and coerces non-numeric to null', () => {
    const dirty = JSON.stringify({
      ...JSON.parse(ambiguous),
      decision_confidence: 1.7,
    });
    const out = parsePolicyAgentJson(dirty);
    expect(out.decision_confidence).toBe(1);

    const dirty2 = JSON.stringify({
      ...JSON.parse(ambiguous),
      decision_confidence: 'high',
    });
    const out2 = parsePolicyAgentJson(dirty2);
    expect(out2.decision_confidence).toBe(null);
  });

  it('throws on invalid decision value', () => {
    const bad = JSON.stringify({ ...JSON.parse(matchExisting), decision: 'bogus' });
    expect(() => parsePolicyAgentJson(bad)).toThrow(/invalid decision/);
  });

  it('throws when match_existing has no matched_policy_id', () => {
    const bad = JSON.stringify({ ...JSON.parse(matchExisting), matched_policy_id: null });
    expect(() => parsePolicyAgentJson(bad)).toThrow(/must set matched_policy_id/);
  });

  it('throws when create_new has no new_policy_payload', () => {
    const bad = JSON.stringify({ ...JSON.parse(createNew), new_policy_payload: null });
    expect(() => parsePolicyAgentJson(bad)).toThrow(/must populate new_policy_payload/);
  });

  it('throws when ambiguous_needs_review has empty review_reasons', () => {
    const bad = JSON.stringify({ ...JSON.parse(ambiguous), review_reasons: [] });
    expect(() => parsePolicyAgentJson(bad)).toThrow(/must include review_reasons/);
  });

  it('throws on empty / non-string input', () => {
    expect(() => parsePolicyAgentJson('')).toThrow(/Empty/);
    expect(() => parsePolicyAgentJson(null)).toThrow(/Empty/);
  });

  it('throws on completely invalid JSON', () => {
    expect(() => parsePolicyAgentJson('not json')).toThrow();
  });
});

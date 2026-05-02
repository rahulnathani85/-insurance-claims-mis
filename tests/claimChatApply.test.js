// =============================================================================
// tests/claimChatApply.test.js
// =============================================================================
// Tests for the chat copilot's proposed-change parser layer (Slice 7).
//
// The full apply route talks to Supabase + dualWrite, which we don't
// stand up here. What we DO test is the chat-prompt parser
// (parseChatJson) which is the reverse-engineering side of the
// contract — given a Claude/Gemini reply, do we extract the
// reply text + proposedChanges array correctly?
//
// The apply route's path-mapping logic is also exercised by exporting
// a small subset of helpers; if mapPathToClaimColumn / mapComputationPath
// were exported from the route file we'd test those too. They aren't
// (route files don't typically export helpers), so we keep this file
// focused on the prompt parser and let integration tests cover the
// route end-to-end.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { parseChatJson, buildClaimChatPrompt, CLAIM_CHAT_SYSTEM_PROMPT } from '../lib/fsr/chatPrompt.js';

const baseClaim = {
  id: 42,
  ref_number: 'T-012/26-27',
  claim_number: 'NI-SI-249',
  insurer_name: 'New India Assurance',
  insured_name: 'Simero Vitrified Pvt Ltd',
  policy_number: '21210021250200000049',
  lob: 'Marine Cargo',
  status: 'investigation',
};

// -----------------------------------------------------------------------------
// parseChatJson
// -----------------------------------------------------------------------------

describe('parseChatJson', () => {
  it('parses a clean JSON reply with proposedChanges', () => {
    const raw = JSON.stringify({
      reply: 'Yes, the claim is admissible.',
      proposedChanges: [
        { type: 'narrative', section: 'recommendation', currentValue: '', newValue: 'Settle.', reason: 'Admissibility opinion is clear.' },
      ],
    });
    const r = parseChatJson(raw);
    expect(r.reply).toBe('Yes, the claim is admissible.');
    expect(r.proposedChanges).toHaveLength(1);
    expect(r.proposedChanges[0].type).toBe('narrative');
  });

  it('strips ```json code fences', () => {
    const raw = '```json\n' + JSON.stringify({ reply: 'OK', proposedChanges: [] }) + '\n```';
    const r = parseChatJson(raw);
    expect(r.reply).toBe('OK');
    expect(r.proposedChanges).toEqual([]);
  });

  it('falls back to raw text when JSON is malformed', () => {
    const raw = 'I cannot answer that, sorry.';
    const r = parseChatJson(raw);
    expect(r.reply).toBe('I cannot answer that, sorry.');
    expect(r.proposedChanges).toEqual([]);
  });

  it('handles non-string input', () => {
    expect(parseChatJson(null)).toEqual({ reply: '', proposedChanges: [] });
    expect(parseChatJson(undefined)).toEqual({ reply: '', proposedChanges: [] });
    expect(parseChatJson(123)).toEqual({ reply: '', proposedChanges: [] });
  });

  it('coerces non-array proposedChanges to []', () => {
    const raw = JSON.stringify({ reply: 'hi', proposedChanges: 'not an array' });
    const r = parseChatJson(raw);
    expect(r.proposedChanges).toEqual([]);
  });

  it('coerces non-string reply to a string', () => {
    const raw = JSON.stringify({ reply: 42, proposedChanges: [] });
    const r = parseChatJson(raw);
    expect(typeof r.reply).toBe('string');
    expect(r.reply).toBe('42');
  });
});

// -----------------------------------------------------------------------------
// buildClaimChatPrompt
// -----------------------------------------------------------------------------

describe('buildClaimChatPrompt', () => {
  it('throws when claim is missing', () => {
    expect(() => buildClaimChatPrompt({})).toThrow(/claim/);
  });

  it('produces a system prompt that includes claim context', () => {
    const r = buildClaimChatPrompt({
      context: 'FSR',
      claim: baseClaim,
      mergedFields: { ref_number: baseClaim.ref_number },
      narrative: null,
      issues: [],
      photos: [],
    });
    expect(r.system).toContain('Final Survey Report');
    expect(r.system).toContain('CLAIM CONTEXT');
    expect(r.system).toContain('Marine Cargo');
    expect(r.system).toContain('T-012/26-27');
    expect(r.system).toContain('Simero Vitrified Pvt Ltd');
  });

  it('uses ILA report label when context=ILA', () => {
    const r = buildClaimChatPrompt({ context: 'ILA', claim: baseClaim });
    expect(r.system).toContain('Interim Liability Advice');
    expect(r.system).not.toMatch(/Report context: FSR/);
  });

  it('embeds the merged provenance overlay JSON', () => {
    const r = buildClaimChatPrompt({
      context: 'FSR',
      claim: baseClaim,
      mergedFields: {
        ref_number: 'T-012/26-27',
        sum_insured: 50_00_00_000,
      },
    });
    expect(r.system).toContain('Merged provenance overlay');
    expect(r.system).toContain('"sum_insured"');
  });

  it('formats narrative blocks when present', () => {
    const r = buildClaimChatPrompt({
      context: 'FSR',
      claim: baseClaim,
      narrative: {
        causeOfLoss: 'Damage during transit due to jerks and jolts.',
        surveyObservations: '12 boxes torn.',
        policyAdmissibility: 'Admissible.',
        recommendation: 'Settle.',
      },
    });
    expect(r.system).toContain('Current narrative drafts');
    expect(r.system).toContain('jerks and jolts');
    expect(r.system).toContain('12 boxes torn');
  });

  it('says "Narrative not drafted yet" when no narrative provided', () => {
    const r = buildClaimChatPrompt({ context: 'FSR', claim: baseClaim, narrative: null });
    expect(r.system).toContain('Narrative not drafted yet');
  });

  it('lists open issues with severity, code, field, message', () => {
    const r = buildClaimChatPrompt({
      context: 'FSR',
      claim: baseClaim,
      issues: [
        { severity: 'error', code: 'POLICY_DATE_MISSING', field: 'policy_period_to', message: 'Policy expiry not on file.' },
        { severity: 'warn',  code: 'NARRATIVE_GAP',      field: 'narrative.observations', message: 'Observations are empty.' },
      ],
    });
    expect(r.system).toContain('Open issues');
    expect(r.system).toMatch(/\[error\] POLICY_DATE_MISSING/);
    expect(r.system).toMatch(/policy_period_to/);
    expect(r.system).toMatch(/Policy expiry not on file/);
    expect(r.system).toMatch(/\[warn\] NARRATIVE_GAP/);
  });

  it('says "No open issues" when issues array is empty', () => {
    const r = buildClaimChatPrompt({ context: 'FSR', claim: baseClaim, issues: [] });
    expect(r.system).toContain('No open issues');
  });

  it('groups photos by category and flags red-flag entries', () => {
    const r = buildClaimChatPrompt({
      context: 'FSR',
      claim: baseClaim,
      photos: [
        { filename: 'a.jpg', category: 'DAMAGED_CARGO', observations: '12 boxes torn', flags: ['tampering_visible'] },
        { filename: 'b.jpg', category: 'DAMAGED_CARGO', observations: 'tile fragments scattered' },
        { filename: 'c.jpg', category: 'DOCUMENTS',     observations: 'invoice S/2025-26/23184' },
      ],
    });
    expect(r.system).toContain('DAMAGED_CARGO (2)');
    expect(r.system).toContain('DOCUMENTS (1)');
    expect(r.system).toContain('a.jpg');
    expect(r.system).toContain('FLAGS: tampering_visible');
    expect(r.system).toContain('invoice S/2025-26/23184');
  });

  it('says "No photos uploaded yet" when photos is empty', () => {
    const r = buildClaimChatPrompt({ context: 'FSR', claim: baseClaim, photos: [] });
    expect(r.system).toContain('No photos uploaded yet');
  });
});

// -----------------------------------------------------------------------------
// CLAIM_CHAT_SYSTEM_PROMPT — invariants
// -----------------------------------------------------------------------------

describe('CLAIM_CHAT_SYSTEM_PROMPT', () => {
  it('demands strict JSON output (so the parser has something to work with)', () => {
    expect(CLAIM_CHAT_SYSTEM_PROMPT).toMatch(/STRICTLY follow this JSON schema/);
    expect(CLAIM_CHAT_SYSTEM_PROMPT).toMatch(/"reply"/);
    expect(CLAIM_CHAT_SYSTEM_PROMPT).toMatch(/"proposedChanges"/);
  });

  it('lists all four proposed-change types', () => {
    expect(CLAIM_CHAT_SYSTEM_PROMPT).toContain('"field"');
    expect(CLAIM_CHAT_SYSTEM_PROMPT).toContain('"narrative"');
    expect(CLAIM_CHAT_SYSTEM_PROMPT).toContain('"annexure"');
    expect(CLAIM_CHAT_SYSTEM_PROMPT).toContain('"computation"');
  });

  it('emphasises factual / no-invention discipline', () => {
    expect(CLAIM_CHAT_SYSTEM_PROMPT).toMatch(/Stay factual/);
    expect(CLAIM_CHAT_SYSTEM_PROMPT).toMatch(/Never invent/);
  });
});

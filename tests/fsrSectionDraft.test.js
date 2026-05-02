// =============================================================================
// tests/fsrSectionDraft.test.js
// =============================================================================
// Tests for lib/fsr/sectionDraftPrompt.js (Slice 6).
//
// Covers:
//   - buildSectionDraftPrompt finds field metadata from narrativeFields,
//     emits the right label, lengthHint, placeholder hint.
//   - Falls back to a generic prompt when sectionKey isn't in the LOB list.
//   - Compacts the claim payload to drop noisy / null columns.
//   - Includes already-filled narrative blocks in the prompt body.
//   - Includes ILA preliminary view + admissibility when present.
//   - parseSectionDraft strips markdown fences + common preambles.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  buildSectionDraftPrompt,
  parseSectionDraft,
  SECTION_DRAFT_SYSTEM_PROMPT,
} from '../lib/fsr/sectionDraftPrompt.js';

const baseClaim = {
  ref_number: 'T-012/26-27',
  claim_number: 'NI-SI-249',
  insurer_name: 'New India Assurance Co. Ltd.',
  insured_name: 'Simero Vitrified Pvt Ltd',
  policy_number: '21210021250200000049',
  lob: 'Marine Cargo',
  lob_subcategory: 'Marine Cargo Open Policy',
  date_loss: '2026-04-04',
  date_of_intimation: '2026-04-07',
  loss_location: 'Chennai',
  company: 'Acuere',
  sum_insured: 50_00_00_000,
  gross_loss: 28_000,
  // noise that should be stripped from the prompt
  id: 42,
  status: 'investigation',
  created_at: '2026-04-07T08:00:00Z',
  some_internal_flag: true,
  null_field: null,
};

// -----------------------------------------------------------------------------
// Field metadata lookup
// -----------------------------------------------------------------------------

describe('buildSectionDraftPrompt — field lookup', () => {
  it('finds the Marine "situation_of_loss" field and surfaces its label', () => {
    const r = buildSectionDraftPrompt({
      sectionKey: 'situation_of_loss',
      lob: 'Marine Cargo',
      claim: baseClaim,
    });
    expect(r.fieldLabel).toBe('Situation of loss');
    expect(r.user).toContain('"Situation of loss"');
    expect(r.user).toContain('situation_of_loss');
  });

  it('finds Marine "person_contacted" (single-line field) and emits the one-line length hint', () => {
    const r = buildSectionDraftPrompt({
      sectionKey: 'person_contacted',
      lob: 'Marine Cargo',
      claim: baseClaim,
    });
    expect(r.fieldLabel).toBe('Person contacted');
    expect(r.user).toMatch(/one-line/);
    expect(r.user).not.toMatch(/2-5 sentences/);
  });

  it('finds textarea fields and emits the multi-sentence length hint', () => {
    const r = buildSectionDraftPrompt({
      sectionKey: 'observations',
      lob: 'Marine Cargo',
      claim: baseClaim,
    });
    expect(r.fieldLabel).toBe('Our observations / findings');
    expect(r.user).toMatch(/2-5 sentences/);
    expect(r.user).toMatch(/multi-paragraph is fine/);
  });

  it('finds EW fields when LOB is Extended Warranty', () => {
    const r = buildSectionDraftPrompt({
      sectionKey: 'customer_complaint',
      lob: 'Extended Warranty',
      claim: { ...baseClaim, lob: 'Extended Warranty' },
    });
    expect(r.fieldLabel).toBe('Customer complaint');
  });

  it('finds Fire fields when LOB is Fire', () => {
    const r = buildSectionDraftPrompt({
      sectionKey: 'about_insured',
      lob: 'Fire',
      claim: { ...baseClaim, lob: 'Fire' },
    });
    expect(r.fieldLabel).toBe('About the insured (background)');
  });

  it('finds ILA-only fields (preliminary_findings)', () => {
    const r = buildSectionDraftPrompt({
      sectionKey: 'preliminary_findings',
      lob: 'Marine Cargo',
      claim: baseClaim,
    });
    expect(r.fieldLabel).toBe('Preliminary findings');
    expect(r.user).toMatch(/2-5 sentences/);  // textarea
  });

  it('falls back to a generic prompt when sectionKey is not in the LOB list', () => {
    const r = buildSectionDraftPrompt({
      sectionKey: 'made_up_custom_key',
      lob: 'Marine Cargo',
      claim: baseClaim,
    });
    expect(r.fieldLabel).toBe('made_up_custom_key');
    expect(r.user).toContain('"made_up_custom_key"');
    expect(r.user).toContain('Output the plain-text content only');
  });
});

// -----------------------------------------------------------------------------
// Claim compaction
// -----------------------------------------------------------------------------

describe('buildSectionDraftPrompt — claim compaction', () => {
  it('drops null and unrecognised columns (id, status, created_at, internal flags)', () => {
    const r = buildSectionDraftPrompt({
      sectionKey: 'situation_of_loss',
      lob: 'Marine Cargo',
      claim: baseClaim,
    });
    expect(r.user).not.toMatch(/some_internal_flag/);
    expect(r.user).not.toMatch(/null_field/);
    expect(r.user).not.toMatch(/created_at/);
    // Strict check: the leaked id 42 should NOT appear as a context field
    // (might appear elsewhere — e.g. policy_number 49 — so we use a
    // labelled match)
    expect(r.user).not.toMatch(/^\s*id:\s*42/m);
  });

  it('keeps the FSR-relevant columns', () => {
    const r = buildSectionDraftPrompt({
      sectionKey: 'situation_of_loss',
      lob: 'Marine Cargo',
      claim: baseClaim,
    });
    expect(r.user).toMatch(/ref_number:\s*T-012\/26-27/);
    expect(r.user).toMatch(/insured_name:\s*Simero Vitrified Pvt Ltd/);
    expect(r.user).toMatch(/policy_number:\s*21210021250200000049/);
  });
});

// -----------------------------------------------------------------------------
// Already-filled narrative + ILA inclusion
// -----------------------------------------------------------------------------

describe('buildSectionDraftPrompt — context inclusion', () => {
  it('mentions filled narrative blocks so the AI stays consistent', () => {
    const r = buildSectionDraftPrompt({
      sectionKey: 'situation_of_loss',
      lob: 'Marine Cargo',
      claim: baseClaim,
      currentNarrative: {
        observations: 'During our survey, 12 boxes were noted in damaged condition.',
        person_contacted: 'Mr. Melbin Jose',
        empty_field: '',  // should be filtered out
      },
    });
    expect(r.user).toMatch(/Narrative blocks already filled/);
    expect(r.user).toMatch(/observations:.*12 boxes/);
    expect(r.user).toMatch(/person_contacted:.*Mr\. Melbin Jose/);
    expect(r.user).not.toMatch(/empty_field/);
  });

  it('omits the "filled blocks" header when nothing is filled', () => {
    const r = buildSectionDraftPrompt({
      sectionKey: 'situation_of_loss',
      lob: 'Marine Cargo',
      claim: baseClaim,
      currentNarrative: {},
    });
    expect(r.user).not.toMatch(/Narrative blocks already filled/);
  });

  it('includes the ILA preliminary view and admissibility when present', () => {
    const r = buildSectionDraftPrompt({
      sectionKey: 'situation_of_loss',
      lob: 'Marine Cargo',
      claim: baseClaim,
      ila: {
        preliminary_view: 'Damage during transit due to jerks and jolts',
        admissibility_opinion: 'admissible',
        admissibility_reasoning: 'Cause is an insured peril; loss within policy period.',
      },
    });
    expect(r.user).toMatch(/Latest ILA submission/);
    expect(r.user).toMatch(/preliminary_view:.*jerks and jolts/);
    expect(r.user).toMatch(/admissibility:\s*admissible/);
    expect(r.user).toMatch(/reasoning:.*insured peril/);
  });

  it('omits the ILA block when ila is null', () => {
    const r = buildSectionDraftPrompt({
      sectionKey: 'situation_of_loss',
      lob: 'Marine Cargo',
      claim: baseClaim,
      ila: null,
    });
    expect(r.user).not.toMatch(/Latest ILA submission/);
  });

  it('includes surveyorNotes verbatim', () => {
    const r = buildSectionDraftPrompt({
      sectionKey: 'situation_of_loss',
      lob: 'Marine Cargo',
      claim: baseClaim,
      surveyorNotes: 'Note: consignee mentioned road was under repair near Padgha.',
    });
    expect(r.user).toMatch(/Surveyor's free-form notes/);
    expect(r.user).toMatch(/road was under repair near Padgha/);
  });

  it('includes the placeholder as a tone reference when present', () => {
    const r = buildSectionDraftPrompt({
      sectionKey: 'situation_of_loss',
      lob: 'Marine Cargo',
      claim: baseClaim,
    });
    expect(r.user).toMatch(/Example tone/);
    // Marine situation_of_loss has a placeholder starting with "The consignee's"
    expect(r.user).toMatch(/The consignee/);
  });
});

// -----------------------------------------------------------------------------
// System prompt
// -----------------------------------------------------------------------------

describe('SECTION_DRAFT_SYSTEM_PROMPT', () => {
  it('demands plain text (not JSON) output', () => {
    expect(SECTION_DRAFT_SYSTEM_PROMPT).toMatch(/plain-text/);
    expect(SECTION_DRAFT_SYSTEM_PROMPT).toMatch(/No JSON/);
  });

  it('forbids invention of figures / dates / parties', () => {
    expect(SECTION_DRAFT_SYSTEM_PROMPT).toMatch(/Do NOT invent/);
    expect(SECTION_DRAFT_SYSTEM_PROMPT).toMatch(/\[to be confirmed\]/);
  });
});

// -----------------------------------------------------------------------------
// Required-input validation
// -----------------------------------------------------------------------------

describe('buildSectionDraftPrompt — validation', () => {
  it('throws when sectionKey is missing', () => {
    expect(() => buildSectionDraftPrompt({ lob: 'Marine Cargo', claim: baseClaim }))
      .toThrow(/sectionKey/);
  });

  it('throws when claim is missing', () => {
    expect(() => buildSectionDraftPrompt({ sectionKey: 'observations', lob: 'Marine Cargo' }))
      .toThrow(/claim/);
  });
});

// -----------------------------------------------------------------------------
// parseSectionDraft
// -----------------------------------------------------------------------------

describe('parseSectionDraft', () => {
  it('returns the trimmed input when there is nothing to strip', () => {
    expect(parseSectionDraft('The consignment was damaged in transit.')).toBe(
      'The consignment was damaged in transit.'
    );
  });

  it('strips markdown fences', () => {
    expect(parseSectionDraft('```\nDraft text\n```')).toBe('Draft text');
    expect(parseSectionDraft('```text\nDraft text\n```')).toBe('Draft text');
  });

  it('strips a "Here is the draft:" preamble', () => {
    expect(parseSectionDraft('Here is the draft:\nThe consignment was damaged.'))
      .toBe('The consignment was damaged.');
    expect(parseSectionDraft('Here is the section: Hello'))
      .toBe('Hello');
  });

  it('strips a "Draft:" preamble', () => {
    expect(parseSectionDraft('Draft: Hello world')).toBe('Hello world');
    expect(parseSectionDraft('Draft - Hello world')).toBe('Hello world');
  });

  it('returns empty string for non-string input', () => {
    expect(parseSectionDraft(null)).toBe('');
    expect(parseSectionDraft(undefined)).toBe('');
    expect(parseSectionDraft(123)).toBe('');
    expect(parseSectionDraft({ foo: 'bar' })).toBe('');
  });

  it('handles a model response that includes both fences and a preamble', () => {
    const raw = '```\nHere is the draft:\nThe damage was caused by jerks and jolts during transit.\n```';
    expect(parseSectionDraft(raw)).toBe(
      'The damage was caused by jerks and jolts during transit.'
    );
  });
});

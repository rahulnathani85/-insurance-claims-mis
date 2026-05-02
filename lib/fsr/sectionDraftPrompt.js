// =============================================================================
// lib/fsr/sectionDraftPrompt.js
// =============================================================================
// Slice 6 — focused per-section AI drafting.
//
// The user clicks the ✨ AI button next to a single narrative textarea
// (e.g. "Situation of loss" or "Observations"). We build a tightly-
// scoped prompt that:
//
//   - Names the section the model is drafting and shows the field's
//     real label as it appears in the FSR.
//   - Supplies the LOB context, claim data, and any other narrative
//     blocks the surveyor has already filled in (so the AI's output
//     stays consistent in tone and references — e.g. if the surveyor
//     wrote "12 boxes were torn" in observations, the AI's
//     situation_of_loss should reference 12 boxes too).
//   - Lifts the field's `placeholder` from `narrativeFields.js` so
//     the model copies the right tone (one-liner vs paragraph;
//     factual vs verbatim quote).
//   - Asks for a single plain-text string back. NOT JSON. The route
//     wraps the response into the right narrative_jsonb key.
//
// Contrast with `draftNarrativePrompt.js` which drafts the AI-pack's
// four standard sections (causeOfLoss / surveyObservations /
// policyAdmissibility / recommendation) in one call, returning JSON.
// That helper is still useful when the surveyor wants to bootstrap
// all four at once. This one is the inline-textarea equivalent.
// =============================================================================

import { fieldsForLob } from './narrativeFields.js';

const SYSTEM_PROMPT = `You are a senior IRDAI-licensed Insurance Surveyor & Loss Assessor at NISLA / ACUERE, drafting a SINGLE narrative section of a Final Survey Report.

Style rules:
- Third person, past tense, formal English. Refer to yourself / the surveyor team as "we" or "the undersigned".
- Be factual. Never embellish or speculate. Use only facts present in the claim data and surveyor notes provided.
- Use full insurer name and policy number where relevant.
- Length matches the section: short labels (e.g. "Person contacted", "Vehicle make") get one line. Free-form sections (e.g. "Situation of loss", "Observations") get 2-5 sentences. Multi-paragraph fine for "Observations".
- Do NOT invent figures, parties, or dates. If a needed fact is missing, write "[to be confirmed]" inline.
- Never quote uncertainty in section headers like "(maybe)" or "(I'm guessing)" — the surveyor sees the output and edits it.

Output: just the plain-text content of the section. No JSON. No markdown. No preamble like "Here is the draft" — go straight to the section text.`;

// -----------------------------------------------------------------------------
// buildSectionDraftPrompt
// -----------------------------------------------------------------------------
// Inputs:
//   sectionKey       string   the narrative.* key (e.g. 'situation_of_loss')
//   lob              string   'Marine Cargo' | 'Extended Warranty' | 'Fire' | ...
//   claim            object   the canonical claims row (column subset OK)
//   currentNarrative object   what the surveyor has already filled in
//   surveyorNotes?   string   free-form notes the surveyor typed
//   ila?             object   { preliminary_view, admissibility_opinion, admissibility_reasoning }
//
// Returns: { system, user, fieldLabel } — fieldLabel is included so the
// caller can show "Drafting Situation of loss…" in the UI.
// -----------------------------------------------------------------------------
export function buildSectionDraftPrompt({
  sectionKey,
  lob,
  claim,
  currentNarrative = {},
  surveyorNotes = '',
  ila = null,
}) {
  if (!sectionKey) throw new Error('buildSectionDraftPrompt: sectionKey is required');
  if (!claim) throw new Error('buildSectionDraftPrompt: claim is required');

  // Find the field metadata (label, placeholder, help, type, wide).
  const field = findField(lob, sectionKey);
  if (!field) {
    // Section isn't in the LOB's field list — caller-supplied custom key.
    // Fall back to a generic prompt.
    return {
      system: SYSTEM_PROMPT,
      user: buildGenericUser({ sectionKey, claim, currentNarrative, surveyorNotes, ila }),
      fieldLabel: sectionKey,
    };
  }

  const labelText = field.label;
  const placeholder = field.placeholder ? `\nExample tone (DO NOT copy verbatim — use as a tone reference only):\n  "${field.placeholder}"` : '';
  const helpText = field.help ? `\nGuidance: ${field.help}` : '';
  const lengthHint = field.type === 'textarea'
    ? 'Draft 2-5 sentences (multi-paragraph is fine for Observations).'
    : 'Draft a one-line answer.';

  // Build a compact context block. Strip noisy / null fields from the
  // claim payload so the prompt stays focused.
  const claimSummary = compactClaim(claim);
  const filledNarrative = filterFilled(currentNarrative);

  const user = [
    `LOB: ${lob || 'Unknown'}`,
    `Section to draft: "${labelText}" (${sectionKey})`,
    `${lengthHint}${placeholder}${helpText}`,
    '',
    `Claim context:\n${formatKv(claimSummary)}`,
    Object.keys(filledNarrative).length > 0
      ? `\nNarrative blocks already filled by the surveyor (your draft must be consistent with these):\n${formatKv(filledNarrative)}`
      : '',
    ila && (ila.preliminary_view || ila.admissibility_reasoning)
      ? `\nLatest ILA submission:\n  preliminary_view: ${ila.preliminary_view || '(none)'}\n  admissibility: ${ila.admissibility_opinion || '(pending)'}\n  reasoning: ${ila.admissibility_reasoning || '(none)'}`
      : '',
    surveyorNotes
      ? `\nSurveyor's free-form notes for this section:\n${surveyorNotes}`
      : '',
    '',
    `Now draft the "${labelText}" section. Output the plain-text content only.`,
  ].filter(Boolean).join('\n');

  return { system: SYSTEM_PROMPT, user, fieldLabel: labelText };
}

// -----------------------------------------------------------------------------
// parseSectionDraft — defensive trim of the model's reply
// -----------------------------------------------------------------------------
// Strips markdown fences, leading "Draft:" or "Here is the draft:" preambles,
// and trailing whitespace. Returns the cleaned string.
// -----------------------------------------------------------------------------
export function parseSectionDraft(text) {
  if (typeof text !== 'string') return '';
  let s = text.replace(/```[a-z]*|```/gi, '').trim();
  // Strip a single-line preamble like "Here is the draft:" or "Draft:"
  s = s.replace(/^(?:Here\s+is\s+(?:the\s+)?(?:draft|section).*?[:\-]\s*)/i, '');
  s = s.replace(/^Draft\s*[:\-]\s*/i, '');
  return s.trim();
}

// =============================================================================
// helpers
// =============================================================================

function findField(lob, key) {
  // Walk every section group for the LOB (Production AND ILA) so any
  // narrative key surfaces.
  const sections = fieldsForLob(lob, 'ILA');
  for (const s of sections) {
    for (const f of s.fields) {
      if (f.key === key) return f;
    }
  }
  return null;
}

function compactClaim(claim) {
  const keep = [
    'ref_number', 'claim_number', 'company',
    'insurer_name', 'insured_name', 'policy_number',
    'lob', 'lob_subcategory',
    'date_loss', 'date_of_intimation', 'registered_at',
    'loss_location',
    'policy_period_from', 'policy_period_to',
    'sum_insured', 'gross_loss', 'estimated_loss_amount',
  ];
  const out = {};
  for (const k of keep) {
    if (claim[k] !== null && claim[k] !== undefined && claim[k] !== '') {
      out[k] = claim[k];
    }
  }
  return out;
}

function filterFilled(narrative) {
  const out = {};
  for (const [k, v] of Object.entries(narrative || {})) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

function formatKv(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
}

function buildGenericUser({ sectionKey, claim, currentNarrative, surveyorNotes, ila }) {
  const claimSummary = compactClaim(claim);
  const filled = filterFilled(currentNarrative);
  return [
    `Section to draft: "${sectionKey}"`,
    `Draft a single, factual paragraph appropriate for this section in an FSR.`,
    '',
    `Claim context:\n${formatKv(claimSummary)}`,
    Object.keys(filled).length ? `\nNarrative already filled:\n${formatKv(filled)}` : '',
    ila ? `\nILA preliminary view: ${ila.preliminary_view || '(none)'}` : '',
    surveyorNotes ? `\nSurveyor notes: ${surveyorNotes}` : '',
    '',
    `Output the plain-text content only.`,
  ].filter(Boolean).join('\n');
}

export { SYSTEM_PROMPT as SECTION_DRAFT_SYSTEM_PROMPT };

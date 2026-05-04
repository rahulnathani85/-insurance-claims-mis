// ============================================================
// lib/comms/prompts/policyRegistrationAgentPrompt.js
// ------------------------------------------------------------
// Policy Registration Agent — sister to the Claim Registration
// Agent. Given a set of policy fields the Claim Agent extracted
// from intimation materials, plus a small candidate list from
// the policies master table (assembled by the lookup helper in
// lib/comms/policyCandidateLookup.js), this agent decides:
//   - match_existing       (pick a candidate)
//   - create_new           (insert a new policies row)
//   - ambiguous_needs_review (escalate to a human)
//
// The agent never writes to the database. The submit-time helper
// lib/comms/applyPolicyDecision.js consumes the decision and
// performs the corresponding side-effect.
// ============================================================

// ------------------------------------------------------------
// INSURER_ALIAS_MAP
// ------------------------------------------------------------
// Sourced directly from the insurers seed in
// supabase/migrations/20260407045743_initial_schema.sql:154-182.
// Used in two places:
//   1. Injected into the system prompt so the LLM has the exact
//      canonical names rather than paraphrasing.
//   2. Available for deterministic post-processing if the LLM
//      hallucinates a non-canonical insurer name (caller's choice).
// Keep in sync with the insurers seed if more rows get added.
// ------------------------------------------------------------
export const INSURER_ALIAS_MAP = [
  { code: 'NIAC',  canonical: 'The New India Assurance Co. Ltd.',         aliases: ['NIACL', 'New India Assurance', 'New India'] },
  { code: 'UIIC',  canonical: 'United India Insurance Co. Ltd.',          aliases: ['UIICL', 'United India'] },
  { code: 'OICL',  canonical: 'The Oriental Insurance Co. Ltd.',          aliases: ['Oriental', 'Oriental Insurance'] },
  { code: 'NICL',  canonical: 'National Insurance Co. Ltd.',              aliases: ['National Insurance', 'National'] },
  { code: 'ICICI', canonical: 'ICICI Lombard General Insurance Co. Ltd.', aliases: ['ICICI Lombard'] },
  { code: 'HDFC',  canonical: 'HDFC ERGO General Insurance Co. Ltd.',     aliases: ['HDFC ERGO'] },
  { code: 'BAJAJ', canonical: 'Bajaj Allianz General Insurance Co. Ltd.', aliases: ['Bajaj Allianz'] },
  { code: 'TATA',  canonical: 'Tata AIG General Insurance Co. Ltd.',      aliases: ['Tata AIG'] },
  { code: 'SBI',   canonical: 'SBI General Insurance Co. Ltd.',           aliases: ['SBI General'] },
  { code: 'RELI',  canonical: 'Reliance General Insurance Co. Ltd.',      aliases: ['Reliance General', 'Reliance'] },
  { code: 'IFFCO', canonical: 'IFFCO Tokio General Insurance Co. Ltd.',   aliases: ['IFFCO Tokio'] },
  { code: 'CHOL',  canonical: 'Cholamandalam MS General Insurance Co. Ltd.', aliases: ['Cholamandalam', 'Chola MS'] },
  { code: 'FUTU',  canonical: 'Future Generali India Insurance Co. Ltd.', aliases: ['Future Generali'] },
  { code: 'STAR',  canonical: 'Star Health & Allied Insurance Co. Ltd.',  aliases: ['Star Health'] },
  { code: 'ROYAL', canonical: 'Royal Sundaram General Insurance Co. Ltd.', aliases: ['Royal Sundaram'] },
  { code: 'MAGMA', canonical: 'Magma HDI General Insurance Co. Ltd.',     aliases: ['Magma HDI'] },
  { code: 'NAVI',  canonical: 'Navi General Insurance Ltd.',              aliases: ['Navi'] },
  { code: 'ACKO',  canonical: 'Acko General Insurance Ltd.',              aliases: ['Acko'] },
  { code: 'GODIG', canonical: 'Go Digit General Insurance Ltd.',          aliases: ['Go Digit', 'Digit'] },
  { code: 'LIBER', canonical: 'Liberty General Insurance Ltd.',           aliases: ['Liberty'] },
  { code: 'KOTAK', canonical: 'Kotak Mahindra General Insurance Co. Ltd.', aliases: ['Kotak Mahindra', 'Kotak'] },
  { code: 'RAHEJ', canonical: 'Raheja QBE General Insurance Co. Ltd.',    aliases: ['Raheja QBE', 'Raheja'] },
  { code: 'SHRIR', canonical: 'Shriram General Insurance Co. Ltd.',       aliases: ['Shriram'] },
  { code: 'UNIVE', canonical: 'Universal Sompo General Insurance Co. Ltd.', aliases: ['Universal Sompo', 'Universal'] },
  { code: 'ZURIC', canonical: 'Zurich Kotak General Insurance Co. Ltd.',  aliases: ['Zurich Kotak'] },
  { code: 'ECGC',  canonical: 'ECGC Ltd.',                                aliases: [] },
  { code: 'AIC',   canonical: 'Agriculture Insurance Co. of India Ltd.', aliases: ['AIC India'] },
  { code: 'GIC',   canonical: 'GIC Re (General Insurance Corporation of India)', aliases: ['GIC Re'] },
];

const MAX_BODY_CHARS = 8000;

// ------------------------------------------------------------
// formatAliasMapForPrompt
// Renders the alias map as a compact bullet list the LLM can
// consume without choking the context window.
// ------------------------------------------------------------
function formatAliasMapForPrompt(map) {
  return map
    .map((row) => {
      const aliases = row.aliases.length > 0 ? ` ⟵ ${row.aliases.join(', ')}` : '';
      return `  • ${row.canonical}${aliases}`;
    })
    .join('\n');
}

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n) + '\n…[truncated]' : s;
}

// ------------------------------------------------------------
// buildPolicyAgentPrompt
//   inputs:
//     extractedPolicy:  { policy_number?, insurer?, insured_name?, ... }
//                       each value-shape: { value, confidence, source }
//     candidateMatches: 0 to 5 rows from policy_master/policies
//     claimContext:     { claim_id, ref_number, lob, company }
//
//   returns: { systemPrompt, userMessage }
// ------------------------------------------------------------
export function buildPolicyAgentPrompt({
  extractedPolicy = {},
  candidateMatches = [],
  claimContext = {},
} = {}) {
  const aliasList = formatAliasMapForPrompt(INSURER_ALIAS_MAP);

  const systemPrompt = [
    'You are the Policy Registration Agent for Nathani Insurance Surveyors & Loss Assessors Pvt. Ltd. (NISLA), an IRDAI-licensed surveyor firm. Your single responsibility: given a set of policy details extracted from a claim intimation, decide whether that policy already exists in the policy master, or whether a new policy record should be created. You return a structured decision; you never write to the database yourself.',
    '',
    'You coordinate with the Claim Registration Agent. The Claim Agent gives you what it extracted from intimation emails and supporting documents. Code (not you) has already searched the policy_master table and given you a small candidate list of possible matches. Your job is to pick the right one — or confirm there is no match — and produce a clean, canonical set of policy fields the Claim Agent should record on the claim.',
    '',
    'INPUTS YOU WILL RECEIVE',
    '  1. extracted_policy: fields the Claim Agent pulled from the intimation, each with { value, confidence, source }.',
    '  2. candidate_matches: 0 to 5 rows from the policy_master table that the lookup code thinks might be the same policy. Each row has all master fields + { id, source, verified, created_at }.',
    '  3. claim_context: { claim_id, ref_number, lob, company } — for your reasoning, not for output.',
    '',
    'DECISION RULES',
    '',
    '  A. match_existing — pick a candidate when ALL of the following hold:',
    '     - The candidate\'s policy_number is an exact match (after normalizing: uppercase, strip whitespace, strip leading/trailing dashes) to the extracted policy_number, OR',
    '     - The candidate\'s policy_number differs only by trivial OCR-like variants (O↔0, I↔1, common dash/space differences) AND insurer + insured_name + policy period align to the extracted values.',
    '     - The candidate\'s insurer matches the extracted insurer_name allowing for known abbreviations (see INSURER ALIASES below).',
    '       Acronyms / "Pvt Ltd" / "Limited" / "Co." / "Company" are not material.',
    '     - When multiple candidates qualify, prefer: verified=true > most recent created_at > most fields populated.',
    '',
    '  B. create_new — when no candidate qualifies, AND the extracted_policy has at least: policy_number (confidence ≥ 0.80), insurer_name (confidence ≥ 0.60), and ONE of insured_name / sum_insured / policy_period_from.',
    '',
    '  C. ambiguous_needs_review — when:',
    '     - Two or more candidates qualify with similar strength (cannot rank confidently), OR',
    '     - The extracted policy_number conflicts materially with the only candidate that matches on insurer+insured (e.g. different last 4 digits — could be a renewal), OR',
    '     - The extracted policy_number has confidence < 0.80, OR',
    '     - Required fields for create_new are missing.',
    '',
    'CONFLICT HANDLING',
    '',
    'When you choose match_existing, the policy_master is the source of truth. For every field where the master value disagrees with the extracted value, add an entry to "conflicts" with both values and a one-line reason. The merged_policy_fields you return MUST use the master\'s values for shared fields. For fields the master is missing but the extraction has, fill from the extraction (with source="extracted") so the master can be enriched later.',
    '',
    'When you choose create_new, produce new_policy_payload using the extracted values, normalized:',
    '  - Dates: DD-MM-YYYY.',
    '  - Amounts: integer rupees as a string (the policies.sum_insured column is TEXT).',
    '  - Names: preserve original casing and prefix (M/s, Mr., Smt.).',
    '  - Policy number: preserve exact format from the extraction.',
    '',
    'NORMALIZATION',
    '  - Insurer name: store the canonical full form (see INSURER ALIASES) not the acronym, when you can identify it.',
    '  - LOB must be one of: Fire, Engineering, Marine Cargo, Marine Hull, Motor, Miscellaneous, LOP. If the extraction gives something else, map it to the closest canonical value or leave null.',
    '',
    'INSURER ALIASES (canonical ⟵ aliases — match either form to the canonical)',
    aliasList,
    '',
    'YOU MUST NOT',
    '  - Decide policy admissibility, coverage, or claim payout. That is the surveyor\'s job.',
    '  - Invent fields not present in any input.',
    '  - Choose match_existing on weak signals just to avoid escalation. Prefer ambiguous_needs_review when in doubt.',
    '  - Modify the extracted_policy values when proposing a create_new (you may normalize, you may not invent).',
    '',
    'OUTPUT FORMAT',
    '',
    'Return ONLY a valid JSON object. No prose, no markdown fences.',
    '',
    '{',
    '  "decision": "match_existing" | "create_new" | "ambiguous_needs_review",',
    '  "decision_confidence": <float 0.0-1.0>,',
    '  "matched_policy_id": <int or null>,',
    '  "merged_policy_fields": {',
    '    "policy_number":      { "value": "...", "source": "master" | "extracted" | "normalized" },',
    '    "insurer":            { "value": "...", "source": "..." },',
    '    "insurer_office":     { "value": "...", "source": "..." },',
    '    "insured_name":       { "value": "...", "source": "..." },',
    '    "insured_address":    { "value": "...", "source": "..." },',
    '    "phone":              { "value": "...", "source": "..." },',
    '    "email":              { "value": "...", "source": "..." },',
    '    "lob":                { "value": "...", "source": "..." },',
    '    "policy_type":        { "value": "...", "source": "..." },',
    '    "sum_insured":        { "value": "...", "source": "..." },',
    '    "premium":            { "value": "...", "source": "..." },',
    '    "start_date":         { "value": "DD-MM-YYYY", "source": "..." },',
    '    "end_date":           { "value": "DD-MM-YYYY", "source": "..." }',
    '  },',
    '  "conflicts": [',
    '    { "field": "sum_insured", "master_value": "2500000", "extracted_value": "5000000", "reason": "Email states ₹50L but master records ₹25L — possible policy revision or extraction error." }',
    '  ],',
    '  "new_policy_payload": null | {',
    '    "policy_number": "...", "insurer": "...", "insurer_office": "...",',
    '    "insured_name": "...", "insured_address": "...", "phone": "...", "email": "...",',
    '    "lob": "...", "policy_type": "...", "sum_insured": "...", "premium": "...",',
    '    "start_date": "...", "end_date": "...", "policy_copy_url": null',
    '  },',
    '  "review_reasons": ["..."],',
    '  "reasoning": "<one paragraph, max 300 chars, explaining the decision>"',
    '}',
    '',
    'If decision is "match_existing": matched_policy_id is set, new_policy_payload is null, review_reasons is [].',
    'If decision is "create_new": matched_policy_id is null, new_policy_payload is populated, review_reasons is [].',
    'If decision is "ambiguous_needs_review": both matched_policy_id and new_policy_payload are null, review_reasons lists the specific issues a human must resolve.',
    '',
    'DO NOT include any text outside the JSON. DO NOT wrap in code fences. DO NOT explain your reasoning anywhere except inside the "reasoning" field.',
  ].join('\n');

  const inputDoc = {
    extracted_policy: extractedPolicy,
    candidate_matches: (candidateMatches || []).slice(0, 5),
    claim_context: {
      claim_id:    claimContext?.claim_id ?? null,
      ref_number:  claimContext?.ref_number ?? null,
      lob:         claimContext?.lob ?? null,
      company:     claimContext?.company ?? null,
    },
  };

  const userMessage =
    `Decide policy resolution for the following inputs. Return the JSON object only.\n\nINPUT:\n${truncate(JSON.stringify(inputDoc, null, 2), MAX_BODY_CHARS)}`;

  return { systemPrompt, userMessage };
}

// ------------------------------------------------------------
// parsePolicyAgentJson(rawText)
// Tolerant parser. Strips markdown fences, validates the shape,
// enforces the discriminated-union invariants. Throws on
// shape violations.
// ------------------------------------------------------------
const VALID_DECISIONS = new Set(['match_existing', 'create_new', 'ambiguous_needs_review']);

export function parsePolicyAgentJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty policy-agent response');
  }
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Policy agent returned invalid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Policy agent JSON is not an object');
  }
  if (!VALID_DECISIONS.has(parsed.decision)) {
    throw new Error(`Policy agent returned invalid decision: ${parsed.decision}`);
  }

  // Discriminated-union invariants per the spec.
  if (parsed.decision === 'match_existing') {
    if (parsed.matched_policy_id == null) {
      throw new Error('match_existing decision must set matched_policy_id');
    }
    if (parsed.new_policy_payload != null) {
      // Be lenient — many models leak the payload anyway. Coerce to null.
      parsed.new_policy_payload = null;
    }
  } else if (parsed.decision === 'create_new') {
    if (!parsed.new_policy_payload || typeof parsed.new_policy_payload !== 'object') {
      throw new Error('create_new decision must populate new_policy_payload');
    }
    if (parsed.matched_policy_id != null) {
      // Same lenience — coerce.
      parsed.matched_policy_id = null;
    }
  } else {
    // ambiguous_needs_review — both must be null; reasons array required.
    parsed.matched_policy_id = null;
    parsed.new_policy_payload = null;
    if (!Array.isArray(parsed.review_reasons) || parsed.review_reasons.length === 0) {
      throw new Error('ambiguous_needs_review must include review_reasons[]');
    }
  }

  // Defensive shape coercions for downstream consumers.
  const conf = Number(parsed.decision_confidence);
  parsed.decision_confidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null;
  parsed.merged_policy_fields = (parsed.merged_policy_fields && typeof parsed.merged_policy_fields === 'object')
    ? parsed.merged_policy_fields : {};
  parsed.conflicts = Array.isArray(parsed.conflicts) ? parsed.conflicts : [];
  parsed.review_reasons = Array.isArray(parsed.review_reasons) ? parsed.review_reasons : [];
  parsed.reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';

  return parsed;
}

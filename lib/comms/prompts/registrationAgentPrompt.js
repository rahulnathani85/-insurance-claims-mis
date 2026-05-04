// ============================================================
// lib/comms/prompts/registrationAgentPrompt.js
// ------------------------------------------------------------
// Registration Agent — second-pass LLM extraction for the claim
// registration form (/claim-registration/<id>).
//
// Distinct from the lean intimation extractor in extractPrompt.js:
//   - Wider schema (~25 form-aligned fields vs 8 in intimation)
//   - Richer output: { fields: { <name>: { value, confidence,
//                                          source, raw_snippet } },
//                      conflicts, missing_critical_fields,
//                      extraction_notes }
//   - Cross-source priority: policy doc > email > OCR docs > existing JSON
//
// Used only at registration time (one-shot per /claim-registration
// page open + manual Re-extract). The intimation extractor still
// handles the comms pipeline's auto-create-claim path.
// ============================================================

import { LOB_SUBCATEGORIES } from '@/lib/lobSubcategories';

const MAX_BODY_CHARS = 12000;
const MAX_OCR_CHARS  = 18000;
const MAX_EXISTING_JSON_CHARS = 4000;

// ------------------------------------------------------------
// REGISTRATION_AGENT_SCHEMA
// ------------------------------------------------------------
// Aligned with the form's SECTIONS in app/claim-registration/[id]/page.js
// and FORM_FIELDS in lib/registrationDraft.js. Skipped fields:
//   ref_number          — set by the user via the Surveyor Reference editor
//   complexity_tier     — surveyor judgment
//   is_catastrophe      — surveyor judgment
//   fee_*               — surveyor judgment
//   remark              — surveyor's note, not extractable
//   loss_location_lat / lng — geocoded post-fact, not in the source text
// ------------------------------------------------------------
export const REGISTRATION_AGENT_SCHEMA = [
  // Insurer
  { key: 'insurer_name',           type: 'string', required: true,  hint: 'Name of the insurer (the company that issued the policy and engaged us)' },
  { key: 'insurer_branch',         type: 'string', required: false, hint: 'Issuing branch / divisional office of the insurer' },
  { key: 'dealing_officer_name',   type: 'string', required: false, hint: 'Name of the insurer\'s dealing / desk officer for this claim' },
  { key: 'dealing_officer_email',  type: 'email',  required: false, hint: 'Email of the dealing officer (often the From: header on the intimation)' },
  { key: 'dealing_officer_phone',  type: 'phone',  required: false, hint: 'Phone of the dealing officer; +91 format if Indian' },

  // Policy
  { key: 'policy_number',          type: 'string', required: true,  hint: 'Insurer\'s policy number, preserve exact format' },
  { key: 'policy_period_from',     type: 'date',   required: true,  hint: 'Policy start date (DD-MM-YYYY)' },
  { key: 'policy_period_to',       type: 'date',   required: true,  hint: 'Policy end date (DD-MM-YYYY)' },
  { key: 'sum_insured',            type: 'amount', required: true,  hint: 'Total sum insured in integer rupees' },
  { key: 'policy_type',            type: 'string', required: false, hint: 'Type of policy, e.g. SFSP, IAR, Mega Risk, Bharat Griha Raksha, Marine Open Cover' },

  // Insured
  { key: 'insured_name',           type: 'string', required: true,  hint: 'Insured / claimant name with prefix (M/s, Mr., Smt.)' },
  { key: 'insured_address',        type: 'string', required: false, hint: 'Full address of the insured; preserve as written' },
  { key: 'insured_contact_phone',  type: 'phone',  required: false, hint: 'Insured\'s phone; +91 format if Indian' },
  { key: 'insured_contact_email',  type: 'email',  required: false, hint: 'Insured\'s email address' },
  { key: 'insured_gstin',          type: 'string', required: false, hint: '15-character GSTIN if mentioned' },

  // Loss
  { key: 'lob',                    type: 'enum',   required: true,  hint: 'IRDAI line of business: Fire, Engineering, Marine Cargo, Marine Hull, Motor, Miscellaneous, LOP' },
  { key: 'lob_subcategory',        type: 'enum',   required: false, hint: 'IRDAI sub-category for the chosen LOB. Must be one of the values listed under "lob_subcategory_options[<lob>]" in the input — copy verbatim, including punctuation/casing. null if unsure or no policy_type evidence.' },
  { key: 'peril_type',             type: 'string', required: false, hint: 'High-level cause class: Fire, Flood, Theft, Cyclone, Earthquake, etc.' },
  { key: 'cause_of_loss',          type: 'string', required: false, hint: 'Specific mechanism: short circuit, road accident, machinery breakdown, water ingress, etc.' },
  { key: 'date_loss',              type: 'date',   required: true,  hint: 'Date of loss (DD-MM-YYYY)' },
  { key: 'date_of_intimation',     type: 'date',   required: true,  hint: 'Date the loss was intimated to us / the insurer (DD-MM-YYYY)' },
  { key: 'loss_location',          type: 'string', required: true,  hint: 'Free-form location of loss; full address or descriptive locator' },
  { key: 'loss_location_pin',      type: 'string', required: true,  hint: '6-digit PIN code of the loss location' },
  { key: 'loss_location_state',    type: 'string', required: false, hint: 'Indian state of the loss location' },
  { key: 'loss_location_district', type: 'string', required: false, hint: 'District / city of the loss location' },

  // Amounts.
  // Note: 'claim amount intimated' is the same operational concept as
  // 'estimated_loss_amount' for NISLA's purposes — both refer to the
  // preliminary loss number stated on the intimation. Capture as one
  // field; if the insurer's letter explicitly distinguishes a 'gross
  // loss' from the intimation amount, that goes in gross_loss.
  { key: 'estimated_loss_amount',  type: 'amount', required: false, hint: 'Preliminary loss estimate / claim amount on the intimation, in integer rupees' },
  { key: 'gross_loss',             type: 'amount', required: false, hint: 'Insurer-stated gross loss in integer rupees, when distinct from the estimate' },
];

// Which fields are "critical" for the missing_critical_fields output.
// User spec: policy_number, insured_name, date_of_loss, cause_of_loss,
// insurer_name, loss_location.
export const CRITICAL_FIELDS = [
  'policy_number',
  'insured_name',
  'date_loss',
  'cause_of_loss',
  'insurer_name',
  'loss_location',
];

// ------------------------------------------------------------
// formatSchemaForPrompt
// Renders the schema as a readable bullet list for the LLM.
// ------------------------------------------------------------
function formatSchemaForPrompt(schema) {
  return schema
    .map((f) => {
      const req = f.required ? ' [REQUIRED]' : '';
      const hint = f.hint ? ` — ${f.hint}` : '';
      return `  • ${f.key} (${f.type})${req}${hint}`;
    })
    .join('\n');
}

// ------------------------------------------------------------
// truncate — defensive trim; LLMs cope with truncation, not OOM
// ------------------------------------------------------------
function truncate(s, n) {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n) + '\n…[truncated]' : s;
}

// ------------------------------------------------------------
// buildRegistrationPrompt({ claim, intimation, attachments,
//                           ocrText, existingExtraction })
// ------------------------------------------------------------
// claim:              the claim row (provides existing values + lob + ref_number)
// intimation:         the inbox_messages row (subject, body_plain, from_address, etc.)
// attachments:        array of { filename, mime_type } for context
// ocrText:            concatenated OCR text from attachments (may be '')
// existingExtraction: the lean-pass JSON from extraction_results.extracted_data,
//                     fed in as "existing JSON" per the user's spec (lowest priority)
//
// Returns: { systemPrompt, userMessage }
// ------------------------------------------------------------
export function buildRegistrationPrompt({
  claim = {},
  intimation = null,
  attachments = [],
  ocrText = '',
  existingExtraction = null,
} = {}) {
  const fields = formatSchemaForPrompt(REGISTRATION_AGENT_SCHEMA);
  const criticalList = CRITICAL_FIELDS.join(', ');

  const systemPrompt = [
    'You are the Claim Registration Agent for Nathani Insurance Surveyors & Loss Assessors Pvt. Ltd. (NISLA), an IRDAI-licensed surveyor firm. Your job is to extract structured data from claim intimation materials and populate a claim registration form.',
    '',
    'INPUTS YOU WILL RECEIVE',
    '  1. Intimation email body (raw text from insurer)',
    '  2. OCR-extracted text from attached documents (policy copy, FIR, invoices, photos with text, etc.)',
    '  3. Pre-existing JSON data from the database (may be partial)',
    '',
    'YOUR TASK',
    'Extract values for every field in the registration schema below. For each field, return: value, confidence score (0.0–1.0), source (which input it came from), and a short raw_snippet proving the value.',
    '',
    '## Registration form schema',
    fields,
    '',
    '## Extraction rules',
    '1. NEVER fabricate values. If a field is not present in any input, return null with confidence 0.0.',
    '2. If multiple inputs conflict, prefer this order: policy_document > intimation_email > ocr_supporting_docs > existing_json. Note every conflict in the "conflicts" array.',
    '3. Cross-verify critical fields (policy_number, sum_insured, date_loss) across sources when possible. Higher cross-verification = higher confidence.',
    '4. Do not infer beyond what is stated. "Fire damage to factory" does NOT mean cause = "short circuit" unless explicitly stated.',
    '',
    '## Normalization rules (Indian insurance context)',
    '- Dates: output format DD-MM-YYYY. Input may be DD/MM/YYYY, "12th March 2026", etc.',
    '- Amounts: output as integer rupees. "Rs. 45 lakhs" → 4500000, "2 Cr" → 20000000, "Rs. 1,23,456" → 123456. Strip currency symbols and commas.',
    '- Policy numbers: preserve exactly as written, no spacing changes.',
    '- Names: preserve original casing and prefixes (M/s, Mr., Smt., etc.).',
    '- Phone numbers: output as +91XXXXXXXXXX format if Indian.',
    '- Addresses: preserve full text, do not abbreviate.',
    '- PIN code: take from the address if not given separately; must be 6 digits.',
    '',
    '## Confidence scoring',
    '- 0.95–1.00: explicit, unambiguous, format-valid.',
    '- 0.80–0.94: clearly present, minor ambiguity (OCR artifact, slight format issue).',
    '- 0.50–0.79: inferable but not stated cleanly; flag for surveyor review.',
    '- 0.01–0.49: weak signal, likely wrong, flag for manual entry.',
    '- 0.00: not found.',
    '',
    '## Output format',
    'Return ONLY a valid JSON object. No prose, no markdown fences, no explanation.',
    '',
    '{',
    '  "fields": {',
    '    "<field_name>": {',
    '      "value": <extracted value or null>,',
    '      "confidence": <float 0.0–1.0>,',
    '      "source": "<email|ocr_<docname>|policy_document|cross_verified|existing_json|null>",',
    '      "raw_snippet": "<short excerpt from source proving the value, max 150 chars>"',
    '    }',
    '  },',
    '  "conflicts": [',
    '    { "field": "<name>", "values": [{ "source": "...", "value": "..." }, ...] }',
    '  ],',
    '  "missing_critical_fields": ["<field_name>", ...],',
    '  "extraction_notes": "<one-line summary of any issues, max 200 chars>"',
    '}',
    '',
    `Critical fields (must be flagged in missing_critical_fields if null): ${criticalList}.`,
    '',
    'DO NOT include any text outside the JSON. DO NOT wrap in code fences. DO NOT explain your reasoning.',
  ].join('\n');

  const inputDoc = {
    intimation_email: intimation
      ? {
          from: intimation.from_address || '(unknown)',
          subject: intimation.subject || '(no subject)',
          received_at: intimation.received_at || null,
          body: truncate(intimation.body_plain || '', MAX_BODY_CHARS),
        }
      : null,
    attachments_ocr_text: truncate(ocrText || '', MAX_OCR_CHARS),
    attachments: (attachments || []).map((a) => ({
      filename: a.filename || a.file_name || '(unnamed)',
      mime_type: a.mime_type || null,
    })),
    existing_json: existingExtraction
      ? truncate(JSON.stringify(existingExtraction), MAX_EXISTING_JSON_CHARS)
      : null,
    claim_context: {
      lob: claim.lob || null,
      ref_number: claim.ref_number || null,
      company: claim.company || null,
      // Per-LOB sub-category lists. The LLM picks the lob first, then must
      // copy the lob_subcategory verbatim from the matching list (or null).
      lob_subcategory_options: LOB_SUBCATEGORIES,
    },
  };

  const userMessage = `Extract for the registration form using the inputs below. Return the JSON object only.\n\nINPUT:\n${JSON.stringify(inputDoc, null, 2)}`;

  return { systemPrompt, userMessage };
}

// ------------------------------------------------------------
// parseRegistrationJson(rawText)
// Tolerates markdown fences and stray prose around the JSON.
// Validates the rich shape: { fields: { <name>: { value, confidence,
// source, raw_snippet } }, conflicts, missing_critical_fields,
// extraction_notes }. Throws Error on malformed input.
// ------------------------------------------------------------
export function parseRegistrationJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty registration-agent response');
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
    throw new Error(`Registration agent returned invalid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Registration agent JSON is not an object');
  }
  if (!parsed.fields || typeof parsed.fields !== 'object' || Array.isArray(parsed.fields)) {
    throw new Error('Registration agent JSON missing "fields" object');
  }

  // Light coercion: ensure each field entry has the four expected keys, even
  // if the LLM omitted one. Don't drop fields the LLM added that aren't in
  // the schema — let downstream filter.
  const out = {
    fields: {},
    conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
    missing_critical_fields: Array.isArray(parsed.missing_critical_fields)
      ? parsed.missing_critical_fields
      : [],
    extraction_notes: typeof parsed.extraction_notes === 'string'
      ? parsed.extraction_notes
      : '',
  };

  for (const [key, raw] of Object.entries(parsed.fields)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const conf = Number(raw.confidence);
    out.fields[key] = {
      value: raw.value === undefined ? null : raw.value,
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null,
      source: typeof raw.source === 'string' ? raw.source : null,
      raw_snippet: typeof raw.raw_snippet === 'string' ? raw.raw_snippet : '',
    };
  }

  // Post-validate the lob/lob_subcategory pair. The LLM occasionally picks a
  // sub-category that doesn't belong to the chosen LOB (e.g. "Marine Cargo"
  // sub under "Fire") or invents a label not in the canonical list. Drop
  // those — the form's dropdown won't render an invalid option anyway.
  out.fields = validateLobSubcategoryField(out.fields);

  return out;
}

// ------------------------------------------------------------
// validateLobSubcategoryField(fields)
// Pure helper. Returns a NEW fields map with lob_subcategory cleared if its
// value is not in LOB_SUBCATEGORIES[chosen_lob]. Exported for tests.
// ------------------------------------------------------------
export function validateLobSubcategoryField(fields) {
  if (!fields || typeof fields !== 'object') return fields;
  const subEntry = fields.lob_subcategory;
  if (!subEntry || subEntry.value == null || subEntry.value === '') return fields;
  const lob = fields.lob?.value;
  const allowed = lob && LOB_SUBCATEGORIES[lob] ? LOB_SUBCATEGORIES[lob] : null;
  if (!allowed) {
    // Unknown / missing LOB — can't validate; surface the model output as-is
    // but cap confidence at 0.4 so the form doesn't paint it green.
    return {
      ...fields,
      lob_subcategory: {
        ...subEntry,
        confidence: Math.min(subEntry.confidence ?? 0, 0.4),
        source: subEntry.source || 'unverified',
      },
    };
  }
  if (!allowed.includes(String(subEntry.value).trim())) {
    return {
      ...fields,
      lob_subcategory: {
        value: null,
        confidence: 0,
        source: 'rejected_invalid_for_lob',
        raw_snippet: subEntry.raw_snippet || '',
      },
    };
  }
  return fields;
}

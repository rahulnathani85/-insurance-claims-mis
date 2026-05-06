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

  // 3-office picker (insurer offices). The agent picks an `id` from the
  // "Available offices for this insurer" table that is injected into the
  // user message at extract time. Hallucinating an id from outside that
  // list is rejected server-side (see registration-extract route's
  // post-parse validation).
  { key: 'appointing_office_id', type: 'number', required: false, hint: 'ID (from the "Available offices" table in the input) of the insurer office that APPOINTED NISLA. Often signs the appointment letter and is named in the intimation email (e.g. "Mumbai Regional Office of HDFC ERGO" → match the RO with city=Mumbai). Pick from the list; do not guess. Set null if no row clearly matches.' },
  { key: 'policy_office_id',     type: 'number', required: false, hint: 'ID of the insurer office that ISSUED the policy. Visible on the policy copy (header / footer / GSTIN block). Pick from the list; do not guess.' },
  { key: 'fsr_office_id',        type: 'number', required: false, hint: 'ID of the office where the FSR will be SUBMITTED. Often identical to appointing_office_id; sometimes a separate central claims hub mentioned in the instructions. Pick from the list; do not guess.' },
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
// formatOfficesForPrompt(offices)
// ------------------------------------------------------------
// Renders the insurer's office list as a Markdown table the LLM picks IDs
// from. Each row gives id, office_code, name, city, state, address (truncated)
// — enough for the agent to match a document mention like "Mumbai Regional
// Office" or "MRO" to the right id.
//
// Returns '' for an empty array — the caller should not include the section
// at all in that case.
// ------------------------------------------------------------
export function formatOfficesForPrompt(offices) {
  if (!Array.isArray(offices) || offices.length === 0) return '';
  const rows = offices.map((o) => {
    const id      = String(o.id ?? '').padStart(4, ' ');
    const code    = String(o.office_code || '').padEnd(4, ' ');
    const name    = String(o.name || '').slice(0, 40).padEnd(40, ' ');
    const city    = String(o.city || '').slice(0, 18).padEnd(18, ' ');
    const state   = String(o.state || '').slice(0, 6).padEnd(6, ' ');
    const address = String(o.address || '').replace(/\n+/g, ' ').slice(0, 60);
    return `| ${id} | ${code} | ${name} | ${city} | ${state} | ${address}`;
  });
  return [
    '| id   | code | name                                     | city               | state  | address',
    '|------|------|------------------------------------------|--------------------|--------|--------',
    ...rows,
  ].join('\n');
}

// ------------------------------------------------------------
// buildRegistrationPrompt({ claim, intimation, attachments,
//                           ocrText, existingExtraction, insurerOffices })
// ------------------------------------------------------------
// claim:              the claim row (provides existing values + lob + ref_number)
// intimation:         the inbox_messages row (subject, body_plain, from_address, etc.)
// attachments:        array of { filename, mime_type } for context
// ocrText:            concatenated OCR text from attachments (may be '')
// existingExtraction: the lean-pass JSON from extraction_results.extracted_data,
//                     fed in as "existing JSON" per the user's spec (lowest priority)
// insurerOffices:     array of insurer_offices rows for the resolved insurer.
//                     When supplied, the agent picks office IDs from this list
//                     for the 3 office-role fields (appointing/policy/fsr).
//                     When empty/missing, the office fields stay null.
//
// Returns: { systemPrompt, userMessage }
// ------------------------------------------------------------
export function buildRegistrationPrompt({
  claim = {},
  intimation = null,
  attachments = [],
  ocrText = '',
  existingExtraction = null,
  insurerOffices = [],
} = {}) {
  const fields = formatSchemaForPrompt(REGISTRATION_AGENT_SCHEMA);
  const criticalList = CRITICAL_FIELDS.join(', ');
  const officesTable = formatOfficesForPrompt(insurerOffices);
  const hasOffices = officesTable.length > 0;

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
    '## Insurer-office picker (3 roles)',
    'The user message includes a table titled "Available offices for this insurer" (when the resolved insurer has any seeded offices). Three of the schema fields — appointing_office_id, policy_office_id, fsr_office_id — must be picked from that table by `id`. NEVER invent an id, NEVER pick an id from a different insurer, NEVER guess. If no row clearly matches the document evidence for a given role, return null with confidence 0.',
    '',
    '### Role definitions',
    '- **appointing_office_id** — the insurer office that APPOINTED NISLA. Often signs the appointment letter and is named in the intimation email body or the From: address (e.g. "Mumbai Regional Office of HDFC ERGO" → match the RO with city=Mumbai).',
    '- **policy_office_id** — the office that ISSUED the policy. Visible on the policy copy in the header / footer / GSTIN block.',
    '- **fsr_office_id** — the office where the FSR will be SUBMITTED. Often identical to appointing_office_id; sometimes a separate central claims hub mentioned in the instructions.',
    '',
    '### Office-code glossary (Indian insurer hierarchy)',
    '- HO  = Head Office (one per insurer; usually Mumbai).',
    '- RO  = Regional Office.',
    '- LCBO = Large / Corporate Branch Office.',
    '- ZO  = Zonal Office.',
    '- RCH = Regional Claims Hub.',
    '- CCH = Corporate Claims Hub.',
    '- BO  = Branch Office.',
    '',
    '### Matching policy when the document is ambiguous',
    '1. Common abbreviations: "MRO" / "Mumbai R.O." / "Mumbai Regional Office" → match the RO whose city = "Mumbai". "MD" / "Mumbai Divisional" → divisional office in Mumbai. "DO" → Divisional Office.',
    '2. When only a city is mentioned, prefer the most senior office in that city by office_code: HO > RO > ZO > LCBO > RCH > CCH > BO.',
    '3. If multiple offices match equally (e.g. two ROs in the same city), set the field to null with confidence 0 and explain in extraction_notes.',
    '4. Do NOT match across insurers. If the document mentions an office that is not in the supplied table, return null — the office is missing from the master and the surveyor will add it manually.',
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

  const officesBlock = hasOffices
    ? [
        '',
        '## Available offices for this insurer',
        `Resolved insurer: ${claim.insurer_name || '(unknown)'}`,
        '',
        'Pick `appointing_office_id`, `policy_office_id`, and `fsr_office_id` from this list ONLY (use the `id` column verbatim). If no row clearly matches the document evidence for a given role, return null.',
        '',
        officesTable,
      ].join('\n')
    : '';

  const userMessage = [
    'Extract for the registration form using the inputs below. Return the JSON object only.',
    '',
    'INPUT:',
    JSON.stringify(inputDoc, null, 2),
    officesBlock,
  ].filter(Boolean).join('\n');

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

// ============================================================
// lib/comms/prompts/extractPrompt.js
// ------------------------------------------------------------
// Stage 3c — builds the EXTRACTION prompt for a triaged message.
//
// Unlike the legacy classifier prompt (which had to choose between
// 8 tags), this prompt is told upfront which tag the human picked.
// It only needs to extract the structured fields per that tag's
// extraction_schema.
//
// Inputs:
//   tagDef       - tag_definitions row (incl. extraction_schema)
//   message      - inbox_messages row (subject, body_plain, etc.)
//   ocrText      - concatenated OCR text from attachments (may be '')
//   attachmentFilenames - array of filenames (for context)
//
// Output: { systemPrompt, userMessage } passed to wrapCallLLM.
// ============================================================

const MAX_BODY_CHARS = 12000;
const MAX_OCR_CHARS  = 18000; // higher cap; OCR'd documents can be long

// Few-shots help Claude produce strictly the JSON shape we want.
// Drawn from the seeded extraction_schema for each tag.
const FEW_SHOTS = [
  {
    tag: 'intimation',
    input: {
      from: 'claims-ops@hdfcergo.com',
      subject: 'Claim Intimation — Policy 2311/MTR/00456789/2024',
      body:
        'Dear Sir/Madam,\n\nThis is to intimate a new motor claim under policy 2311/MTR/00456789/2024.\n' +
        '- Insured: Rajesh Kumar\n' +
        '- Vehicle: Maruti Suzuki Swift MH12 AB 3456\n' +
        '- Date of Loss: 2026-03-14\n' +
        '- Location: Mumbai-Pune Expressway, near Lonavala\n' +
        '- Contact: +91 98765 43210\n' +
        '- Sum Insured: INR 6,50,000\n\nPlease arrange survey at the earliest.\n\nRegards,\nClaims Operations, HDFC ERGO',
      attachments: ['FIR_copy.pdf'],
      ocr_text: '',
    },
    output: {
      policy_no: '2311/MTR/00456789/2024',
      insured_name: 'Rajesh Kumar',
      vehicle_or_property: 'Maruti Suzuki Swift MH12 AB 3456',
      date_of_loss: '2026-03-14',
      location: 'Mumbai-Pune Expressway, near Lonavala',
      contact: '+91 98765 43210',
      sum_insured: 'INR 6,50,000',
      lob: 'Motor OD',
    },
  },
  {
    tag: 'settlement_advice',
    input: {
      from: 'settlements@bajajallianz.co.in',
      subject: 'Settlement Advice — Claim C-2025-0042',
      body:
        'Dear Surveyor,\n\nClaim C-2025-0042 has been settled for INR 1,85,400 on 2026-04-18 via NEFT (UTR HDFCN0416732210). Deductions: INR 14,600 (salvage + depreciation).\n\nPlease mark the claim as closed and raise your final invoice.\n\nRegards,\nSettlements, Bajaj Allianz',
      attachments: [],
      ocr_text: '',
    },
    output: {
      claim_ref: 'C-2025-0042',
      settled_amount: 'INR 1,85,400',
      settlement_date: '2026-04-18',
      deductions: 'INR 14,600 (salvage + depreciation)',
      mode_of_payment: 'NEFT (UTR HDFCN0416732210)',
    },
  },
];

// ------------------------------------------------------------
// Format the extraction_schema as a readable bullet list.
// ------------------------------------------------------------
function formatSchema(schema) {
  const keys = Object.keys(schema || {});
  if (keys.length === 0) return '(no fields to extract)';
  return keys
    .map((k) => {
      const f = schema[k] || {};
      const req = f.required ? ' (required)' : '';
      const hint = f.hint ? ` — ${f.hint}` : '';
      return `  • ${k}: ${f.type || 'string'}${req}${hint}`;
    })
    .join('\n');
}

// ------------------------------------------------------------
// Pick the most relevant few-shot for the requested tag.
// Falls back to the intimation example if nothing matches.
// ------------------------------------------------------------
function pickFewShot(tag) {
  const direct = FEW_SHOTS.find((ex) => ex.tag === tag);
  if (direct) return direct;
  return FEW_SHOTS[0];
}

// ------------------------------------------------------------
// buildExtractPrompt({ tagDef, message, ocrText, attachmentFilenames })
// ------------------------------------------------------------
export function buildExtractPrompt({
  tagDef,
  message,
  ocrText = '',
  attachmentFilenames = [],
}) {
  const tag = tagDef.tag;
  const schema = tagDef.extraction_schema || {};
  const fields = formatSchema(schema);
  const example = pickFewShot(tag);

  const systemPrompt = [
    'You are a structured-data extractor for an Indian general-insurance surveyor back-office.',
    `A human has already categorised this message as: "${tag}" — ${tagDef.display_label}.`,
    `Your job is NOT to re-classify. Just extract the structured fields below.`,
    '',
    '## Fields to extract',
    fields,
    '',
    '## Rules',
    '- If a field is not present in the message OR the OCR\'d attachment text, return empty string "" for strings, null for integers/dates that are unknown.',
    '- Do NOT invent values. Be faithful to what is actually in the source text.',
    '- For dates, normalise to ISO 8601 (YYYY-MM-DD) when possible.',
    '- For amounts, keep the original currency notation (e.g. "INR 1,85,400") — do not normalise.',
    '',
    '## Output contract',
    'Return ONLY a single JSON object with the requested fields as keys. No markdown, no prose, no code fences.',
    '',
    '## Example',
    `INPUT:\n${JSON.stringify(example.input, null, 2)}`,
    '',
    `OUTPUT:\n${JSON.stringify(example.output, null, 2)}`,
  ].join('\n');

  const truncatedBody = (message.body_plain || '').slice(0, MAX_BODY_CHARS);
  const truncatedOcr = (ocrText || '').slice(0, MAX_OCR_CHARS);

  const inputDoc = {
    from: message.from_address || '(unknown)',
    subject: message.subject || '(no subject)',
    body: truncatedBody,
    attachments: attachmentFilenames,
    ocr_text: truncatedOcr,
  };

  const userMessage = `Extract from the following message.\n\nINPUT:\n${JSON.stringify(inputDoc, null, 2)}\n\nReturn the JSON object only.`;

  return { systemPrompt, userMessage };
}

// ------------------------------------------------------------
// parseExtractJson(rawText)
// Strips markdown fences, parses JSON, returns the extracted
// object. Throws on malformed input.
// ------------------------------------------------------------
export function parseExtractJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty extractor response');
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
    throw new Error(`Extractor returned invalid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Extractor JSON is not an object');
  }
  return parsed;
}

// ============================================================
// lib/comms/prompts/classifyPrompt.js
// ------------------------------------------------------------
// Builds the system prompt + user message passed to callAI()
// for classification + structured extraction.
//
// Design:
//   1. Load tag_definitions rows (caller passes them in; this
//      module is pure so it can be unit-tested without DB).
//   2. Render a tag library: name, short description, classifier
//      prompt, and extraction_schema (when present).
//   3. Show a handful of blueprint-sourced few-shot examples so
//      the model sees expected JSON shape for motor intimations
//      and settlement advices.
//   4. Instruct the model to return a SINGLE JSON object. No
//      free-form prose; no markdown fences (we strip them anyway).
//
// The model decides the tag for EVERY incoming message. Even
// tags that don't yet have extractors plumbed (e.g. surveyor_photos
// in Week 2) still get a classification row — downstream code just
// skips the extractor call for tags whose extraction_schema is {}.
// ============================================================

// ------------------------------------------------------------
// Blueprint-sourced few-shot examples.
// Drawn from the sample ingestion fixtures in the blueprint
// (HDFC ERGO motor intimation, Bajaj Allianz settlement advice,
// an internal admin note). Shapes reflect the seeded
// extraction_schema in migration_comms_3_tag_seeds.sql.
// ------------------------------------------------------------
const FEW_SHOTS = [
  {
    input: {
      from: 'claims-ops@hdfcergo.com',
      subject: 'Claim Intimation — Policy 2311/MTR/00456789/2024',
      body:
        'Dear Sir/Madam,\n\n' +
        'This is to intimate a new motor claim under policy 2311/MTR/00456789/2024.\n' +
        '- Insured: Rajesh Kumar\n' +
        '- Vehicle: Maruti Suzuki Swift MH12 AB 3456\n' +
        '- Date of Loss: 2026-03-14\n' +
        '- Location: Mumbai-Pune Expressway, near Lonavala\n' +
        '- Contact: +91 98765 43210\n' +
        '- Sum Insured: INR 6,50,000\n\n' +
        'Please arrange survey at the earliest.\n\nRegards,\nClaims Operations, HDFC ERGO',
      attachments: ['FIR_copy.pdf'],
    },
    output: {
      tag: 'intimation',
      confidence: 0.96,
      reasoning:
        'Insurer-originated new claim notification. Contains policy number, insured, vehicle, date of loss, location, sum insured, and explicit survey request.',
      extracted: {
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
  },
  {
    input: {
      from: 'settlements@bajajallianz.co.in',
      subject: 'Settlement Advice — Claim C-2025-0042',
      body:
        'Dear Surveyor,\n\n' +
        'Claim C-2025-0042 has been settled for INR 1,85,400 on 2026-04-18 via NEFT ' +
        '(UTR HDFCN0416732210). Deductions: INR 14,600 (salvage + depreciation).\n\n' +
        'Please mark the claim as closed and raise your final invoice.\n\nRegards,\nSettlements, Bajaj Allianz',
      attachments: [],
    },
    output: {
      tag: 'settlement_advice',
      confidence: 0.97,
      reasoning:
        'Insurer confirms claim settled. Contains claim ref, settled amount, date, mode of payment (NEFT), and deductions.',
      extracted: {
        claim_ref: 'C-2025-0042',
        settled_amount: 'INR 1,85,400',
        settlement_date: '2026-04-18',
        deductions: 'INR 14,600 (salvage + depreciation)',
        mode_of_payment: 'NEFT (UTR HDFCN0416732210)',
      },
    },
  },
  {
    input: {
      from: 'admin@nisla.in',
      subject: 'Office closed Friday',
      body:
        'Team — the Mumbai office will be closed this Friday for maintenance. ' +
        'Urgent surveys will be coordinated from the Pune office. — Admin',
      attachments: [],
    },
    output: {
      tag: 'internal_admin',
      confidence: 0.94,
      reasoning:
        'Internal office notice about closure. No claim reference, no insurer content, no extraction required.',
      extracted: {},
    },
  },
];

// ------------------------------------------------------------
// buildTagLibraryBlock(tagRows)
// Formats active tag definitions into a compact reference block.
// ------------------------------------------------------------
function buildTagLibraryBlock(tagRows) {
  const lines = [];
  for (const t of tagRows) {
    if (t.enabled === false) continue;
    lines.push(`### ${t.tag} — ${t.display_label}`);
    lines.push(`- When to use: ${t.classifier_prompt}`);
    const schemaKeys = Object.keys(t.extraction_schema || {});
    if (schemaKeys.length > 0) {
      const fields = schemaKeys
        .map((k) => {
          const f = t.extraction_schema[k] || {};
          const req = f.required ? ' (required)' : '';
          const hint = f.hint ? ` — ${f.hint}` : '';
          return `  • ${k}: ${f.type || 'string'}${req}${hint}`;
        })
        .join('\n');
      lines.push(`- Extract (JSON shape):\n${fields}`);
    } else {
      lines.push(`- Extract: none (leave "extracted" as {})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ------------------------------------------------------------
// buildSystemPrompt(tagRows)
// ------------------------------------------------------------
function buildSystemPrompt(tagRows) {
  const tagLibrary = buildTagLibraryBlock(tagRows);
  const allowedTags = tagRows
    .filter((t) => t.enabled !== false)
    .map((t) => `"${t.tag}"`)
    .join(', ');

  const fewShots = FEW_SHOTS.map(
    (ex, i) =>
      `Example ${i + 1}:\nINPUT:\n${JSON.stringify(ex.input, null, 2)}\n\nOUTPUT:\n${JSON.stringify(
        ex.output,
        null,
        2
      )}`
  ).join('\n\n---\n\n');

  return [
    'You are a classifier for an Indian general-insurance surveyor back-office.',
    'Every input is ONE email or WhatsApp message. Read the sender, subject, body, and attachment filenames, then classify the message into exactly ONE of these workflow tags:',
    allowedTags + '.',
    '',
    'If nothing fits, return "internal_admin" with a low confidence (<0.50).',
    '',
    'For tags that have an extraction schema, also extract the listed fields. If a required field is missing from the message, leave it empty ("" or null) and lower your confidence. Do not invent values.',
    '',
    '## Tag library',
    tagLibrary,
    '',
    '## Output contract',
    'Return ONLY a single JSON object, no markdown, no prose, no code fences. Shape:',
    '{',
    '  "tag": "<one of the allowed tags>",',
    '  "confidence": <number between 0 and 1, inclusive>,',
    '  "reasoning": "<one short sentence>",',
    '  "extracted": { ...fields from the tag\'s extraction schema, or {} if none... }',
    '}',
    '',
    '## Examples',
    fewShots,
  ].join('\n');
}

// ------------------------------------------------------------
// buildUserMessage(message, attachmentFilenames)
// Renders the incoming message into the format used in few-shots.
// ------------------------------------------------------------
function buildUserMessage(message, attachmentFilenames = []) {
  // Truncate very long bodies so we stay well under token budget.
  const MAX_BODY_CHARS = 12000;
  const body = (message.body_plain || '').slice(0, MAX_BODY_CHARS);
  const payload = {
    from: message.from_address || '(unknown)',
    subject: message.subject || '(no subject)',
    body,
    attachments: attachmentFilenames,
  };
  return `Classify the following message.\n\nINPUT:\n${JSON.stringify(payload, null, 2)}\n\nRespond with only the JSON object described in the system prompt.`;
}

// ------------------------------------------------------------
// Public helper — builds both halves for callAI().
// ------------------------------------------------------------
export function buildClassifyPrompt({ tagRows, message, attachmentFilenames }) {
  return {
    systemPrompt: buildSystemPrompt(tagRows),
    userMessage: buildUserMessage(message, attachmentFilenames),
  };
}

// ------------------------------------------------------------
// parseClassifierJson(text)
// Strips markdown fences, parses JSON, returns { tag, confidence,
// reasoning, extracted } or throws on malformed input.
// ------------------------------------------------------------
export function parseClassifierJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty classifier response');
  }
  let cleaned = rawText.trim();
  // Strip ```json ... ``` or ``` ... ```
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  // Some providers add leading prose before the object — slice to the first '{'.
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Classifier returned invalid JSON: ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Classifier JSON is not an object');
  }
  const { tag, confidence } = parsed;
  if (!tag || typeof tag !== 'string') {
    throw new Error('Classifier JSON missing "tag"');
  }
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    throw new Error('Classifier JSON has missing/invalid "confidence"');
  }
  return {
    tag,
    confidence,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    extracted:
      parsed.extracted && typeof parsed.extracted === 'object' && !Array.isArray(parsed.extracted)
        ? parsed.extracted
        : {},
  };
}

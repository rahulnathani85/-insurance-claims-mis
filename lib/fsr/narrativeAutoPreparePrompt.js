// =============================================================================
// lib/fsr/narrativeAutoPreparePrompt.js
// =============================================================================
// "Prepare FSR with AI" — server-side prompt builder + JSON parser + merge
// helper for the manual button on the FSR Draft page.
//
// The button hands the agent every piece of evidence the portal already has
// (claim_documents OCR text, intimation email body, claim row, lifecycle
// template, loss sheet, ILA) and asks it to populate the narrative form's
// fields. Output schema is generated at runtime from `lib/fsr/narrativeFields.js`
// — the form and the agent therefore can never drift.
//
// Why a separate prompt (vs. extending the registration agent):
//   - Scoped: the registration agent extracts ~25 claim-row fields; this
//     prompt is ~50+ FSR-narrative fields. Conflating them hurts both.
//   - Triggered explicitly by the surveyor on the FSR Draft page (per the
//     plan), not at registration. Different LOB/template combos see
//     different schemas, so the agent's instructions vary per call.
//   - The Claim Registration Agent stays a stable contract; FSR prep is
//     an iterative loop that the surveyor drives.
// =============================================================================

const MAX_OCR_CHARS_PER_DOC   = 8000;   // per claim_document
const MAX_OCR_TOTAL_CHARS     = 40000;  // hard cap across all docs
const MAX_INTIMATION_CHARS    = 8000;
const MAX_CLAIM_ROW_CHARS     = 4000;   // serialised JSON of the claim row
const MAX_LOSS_SHEET_CHARS    = 4000;
const MAX_ILA_CHARS           = 4000;

// ---------- buildAutoPreparePrompt -----------------------------------------
//
// Inputs:
//   schema        — output of lib/fsr/narrativeFields.js#fieldsForLob().
//                   Sections + fields + (for arrays) itemSchema.
//   claim         — the claims row.
//   templateName  — resolved fsr_template_name (e.g. 'Ultratech_Marine_Cargo_v1').
//   lossSheet     — marine_loss_sheets row (or null).
//   lossItems     — marine_loss_sheet_items rows (or []).
//   ila           — preliminary view + admissibility opinion (or null).
//   ocrDocs       — [{ filename, mime_type, ocr_text }, ...] from claim_documents.
//   intimationBody — text of the intimation email (or '').
//
// Returns: { systemPrompt, userMessage }
// ---------------------------------------------------------------------------
export function buildAutoPreparePrompt({
  schema,
  claim,
  templateName,
  lossSheet,
  lossItems,
  ila,
  ocrDocs,
  intimationBody,
} = {}) {
  if (!Array.isArray(schema) || schema.length === 0) {
    throw new Error('buildAutoPreparePrompt: schema is required and must be a non-empty array');
  }

  // Flatten to (key, label, type, placeholder, sectionTitle, itemSchema?).
  const flatFields = flattenSchema(schema);

  // Build the schema description shown to the LLM.
  const schemaText = formatSchemaForPrompt(flatFields);

  // Build the user message — the assembled evidence payload.
  const evidenceParts = [];

  evidenceParts.push(formatTemplateContext({ templateName, lob: claim?.lob }));
  evidenceParts.push(formatClaimRowContext(claim));
  evidenceParts.push(formatLossSheetContext({ lossSheet, lossItems, lob: claim?.lob }));
  evidenceParts.push(formatIlaContext(ila));
  evidenceParts.push(formatIntimationContext(intimationBody));
  evidenceParts.push(formatOcrDocsContext(ocrDocs));

  const userMessage =
    `## Schema (output JSON keys you must populate)\n\n` +
    schemaText +
    `\n\n## Evidence available to you\n\n` +
    evidenceParts.filter(Boolean).join('\n\n');

  return { systemPrompt: SYSTEM_PROMPT, userMessage };
}

// ---------- SYSTEM_PROMPT ---------------------------------------------------

export const SYSTEM_PROMPT = `You are NISLA's FSR-Narrative Prep Agent. NISLA is an Indian IRDAI-licensed insurance surveyor firm. You are populating the structured narrative fields of a Final Survey Report (FSR) for a marine-cargo or other claim, drawing exclusively on the evidence supplied.

OUTPUT CONTRACT (read carefully):
- Output JSON ONLY. No prose, no markdown, no code fences. Your response must parse with JSON.parse() on the first try.
- Output shape:
    {
      "values":  { "<field_key>": <value-or-null>, ... },
      "sources": { "<field_key>": "<source-tag>", ... },
      "notes":   "optional one-paragraph free text describing anything that seemed inconsistent across sources"
    }
- "values" must contain every field key from the schema below — set the value to null if the evidence does not support a value.
- "sources" must contain the same keys, mapping each to one of: "rr", "jir", "intimation", "invoice", "policy_copy", "claim_row", "loss_sheet", "ila", "inferred", or null.

HARD RULES:
1. NEVER invent data. If the evidence does not directly support a value, return null. "Inferred" is allowed only when a value is mathematically/logically derivable from explicit evidence (e.g. average percent loss from per-row extents).
2. Date format: DD/MM/YYYY for human-facing date fields (date_of_dispatch, rr_date, dates_of_survey, etc.).
3. Money: Indian formatted strings, e.g. "Rs. 43,298/-". Bag counts: plain integers (no thousand separators).
4. For 'array' fields (e.g. damaged_items): emit one row per source-document line item. Match the itemSchema column keys exactly. Leave a column null if the document does not specify it.
5. Free-form narrative fields (incident_narrative, observation_narrative, packing_description) should be 3-6 sentence paragraphs in surveyor-style English. Do not invent witness statements or technical findings the documents do not record.
6. The Joint Inspection Report (JIR) is typically handwritten — OCR is unreliable. If a JIR-derived field (damaged_bags, damaged_mt, extent_pct, loss_allowed_*) is not clearly transcribable, leave it null; do not guess.
7. If a field's value is already explicit on the claim row (e.g. policy_number, insured_name, date_loss), use that value; do not re-extract from documents. Tag source as "claim_row".

PRIORITY OF SOURCES (when multiple disagree):
   policy_copy > rr > invoice > intimation > claim_row > jir > inferred

Be conservative. Half-empty is better than wrong.`;

// ---------- formatSchemaForPrompt ------------------------------------------

function formatSchemaForPrompt(flatFields) {
  // Group by section for readability.
  const bySection = new Map();
  for (const f of flatFields) {
    if (!bySection.has(f.sectionTitle)) bySection.set(f.sectionTitle, []);
    bySection.get(f.sectionTitle).push(f);
  }
  const out = [];
  for (const [title, fields] of bySection) {
    out.push(`### ${title}`);
    for (const f of fields) {
      const ph = f.placeholder ? ` — example: "${f.placeholder.replace(/\n/g, ' ').slice(0, 140)}"` : '';
      if (f.type === 'array' && Array.isArray(f.itemSchema)) {
        const cols = f.itemSchema.map((c) => `${c.key}(${c.type || 'text'})`).join(', ');
        out.push(`- \`${f.key}\` (array of objects with cols: ${cols}) — ${f.label}${ph}`);
      } else {
        out.push(`- \`${f.key}\` (${f.type || 'text'}) — ${f.label}${ph}`);
      }
    }
    out.push('');
  }
  return out.join('\n');
}

// ---------- Evidence formatters --------------------------------------------

function formatTemplateContext({ templateName, lob }) {
  return [
    `### Template + LOB`,
    `- Resolved FSR template: \`${templateName || '(unknown)'}\``,
    `- Line of business: \`${lob || '(unknown)'}\``,
  ].join('\n');
}

function formatClaimRowContext(claim) {
  if (!claim) return null;
  const safe = {
    ref_number:         claim.ref_number,
    claim_number:       claim.claim_number,
    insurer_name:       claim.insurer_name,
    insured_name:       claim.insured_name,
    insured_address:    claim.insured_address,
    policy_number:      claim.policy_number,
    policy_period_from: claim.policy_period_from,
    policy_period_to:   claim.policy_period_to,
    sum_insured:        claim.sum_insured,
    lob:                claim.lob,
    lob_subcategory:    claim.lob_subcategory,
    date_loss:          claim.date_loss,
    date_of_intimation: claim.date_of_intimation,
    loss_location:      claim.loss_location,
    estimated_loss_amount: claim.estimated_loss_amount,
    gross_loss:         claim.gross_loss,
  };
  return `### Claim row (manual entries already in the portal)\n\n` +
    `\`\`\`json\n${truncate(JSON.stringify(safe, null, 2), MAX_CLAIM_ROW_CHARS)}\n\`\`\``;
}

function formatLossSheetContext({ lossSheet, lossItems, lob }) {
  if (!lossSheet && (!lossItems || lossItems.length === 0)) return null;
  const payload = { lob, lossSheet, lossItems };
  return `### Loss sheet (already entered manually for this claim)\n\n` +
    `\`\`\`json\n${truncate(JSON.stringify(payload, null, 2), MAX_LOSS_SHEET_CHARS)}\n\`\`\``;
}

function formatIlaContext(ila) {
  if (!ila) return null;
  return `### ILA submission (preliminary view + admissibility, surveyor's own words)\n\n` +
    `\`\`\`json\n${truncate(JSON.stringify(ila, null, 2), MAX_ILA_CHARS)}\n\`\`\``;
}

function formatIntimationContext(body) {
  if (!body || typeof body !== 'string' || body.trim().length === 0) return null;
  return `### Intimation email body\n\n` +
    `\`\`\`\n${truncate(body, MAX_INTIMATION_CHARS)}\n\`\`\``;
}

function formatOcrDocsContext(docs) {
  if (!Array.isArray(docs) || docs.length === 0) {
    return `### Documents (OCR'd)\n\n_No documents uploaded against this claim. Tag the docs (RR, JIRs, invoices, policy copy) under the Documents tab and re-run._`;
  }
  let totalChars = 0;
  const out = [`### Documents (OCR'd from claim_documents)\n`];
  for (const d of docs) {
    if (totalChars >= MAX_OCR_TOTAL_CHARS) {
      out.push(`\n_(remaining documents truncated for prompt size)_`);
      break;
    }
    const remaining = MAX_OCR_TOTAL_CHARS - totalChars;
    const slice = truncate(d.ocr_text || '', Math.min(MAX_OCR_CHARS_PER_DOC, remaining));
    totalChars += slice.length;
    out.push(`#### ${d.filename || '(unnamed)'} _(mime: ${d.mime_type || '?'})_\n\n\`\`\`\n${slice}\n\`\`\``);
  }
  return out.join('\n');
}

// ---------- flattenSchema ---------------------------------------------------

export function flattenSchema(schema) {
  if (!Array.isArray(schema)) return [];
  const out = [];
  for (const section of schema) {
    if (!section || !Array.isArray(section.fields)) continue;
    for (const f of section.fields) {
      out.push({ ...f, sectionTitle: section.title });
    }
  }
  return out;
}

// ---------- parseAutoPrepareJson -------------------------------------------
//
// Strips ``` fences, parses, and validates the top-level shape.
// Throws on hard parse failure or wrong shape.
//
// Returns:
//   {
//     values:  { <field_key>: <value-or-null>, ... },
//     sources: { <field_key>: <tag-or-null>, ... },
//     notes:   string|null
//   }
// ---------------------------------------------------------------------------
export function parseAutoPrepareJson(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('empty LLM response');
  }
  const stripped = stripCodeFences(text).trim();
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    // Fallback: extract the last { ... } block.
    const m = stripped.match(/\{[\s\S]*\}\s*$/);
    if (!m) throw new Error(`could not parse JSON: ${err.message}`);
    parsed = JSON.parse(m[0]);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('parsed value is not an object');
  }
  const values  = (parsed.values  && typeof parsed.values  === 'object' && !Array.isArray(parsed.values))  ? parsed.values  : {};
  const sources = (parsed.sources && typeof parsed.sources === 'object' && !Array.isArray(parsed.sources)) ? parsed.sources : {};
  const notes   = typeof parsed.notes === 'string' ? parsed.notes : null;
  return { values, sources, notes };
}

function stripCodeFences(s) {
  return s
    .replace(/^\s*```(?:json|JSON)?\s*\n?/, '')
    .replace(/\n?\s*```\s*$/, '')
    .replace(/^\s*```\s*/, '')
    .replace(/\s*```\s*$/, '');
}

// ---------- mergeIntoNarrative ---------------------------------------------
//
// Pure helper. Takes:
//   existing       — current narrative_jsonb (from claim_fsr_drafts)
//   agentValues    — the `values` block parsed from the LLM
//   schema         — output of fieldsForLob()
//
// Returns:
//   {
//     merged:  the new narrative_jsonb to persist
//     filled:  number of keys the agent populated (non-null) and we accepted
//     skipped: number of keys the agent populated but we skipped because the
//              surveyor had already filled them
//     dropped: number of agent keys that were not in the schema (dropped to
//              avoid polluting narrative_jsonb)
//   }
//
// Behaviour:
//   - Only fields present in the schema are considered.
//   - For non-array fields: if existing[key] is non-empty/non-null AND the
//     surveyor already typed something, skip. Otherwise, accept the agent's
//     value (even if null — this clears placeholder text).
//   - For array fields (e.g. damaged_items): if existing already has rows,
//     skip entirely. Otherwise accept the agent's array, dropping any
//     extra columns not in itemSchema.
//   - For both: agent values that pass shape validation overwrite empty/null.
//     Pre-existing surveyor edits are NEVER overwritten.
// ---------------------------------------------------------------------------
export function mergeIntoNarrative(existing, agentValues, schema) {
  const out = { ...(existing && typeof existing === 'object' ? existing : {}) };
  let filled = 0;
  let skipped = 0;
  let dropped = 0;

  if (!agentValues || typeof agentValues !== 'object') {
    return { merged: out, filled, skipped, dropped };
  }

  const flat = flattenSchema(schema);
  const fieldByKey = new Map(flat.map((f) => [f.key, f]));

  // First pass: count keys the agent emitted that aren't in schema (dropped).
  for (const k of Object.keys(agentValues)) {
    if (!fieldByKey.has(k)) dropped += 1;
  }

  // Walk schema fields and merge.
  for (const f of flat) {
    if (!Object.prototype.hasOwnProperty.call(agentValues, f.key)) continue;
    const agentVal = agentValues[f.key];
    const existingVal = out[f.key];

    if (f.type === 'array') {
      // Array merge: skip if existing has rows.
      const existingHasRows = Array.isArray(existingVal) && existingVal.length > 0;
      if (existingHasRows) {
        skipped += 1;
        continue;
      }
      if (Array.isArray(agentVal) && agentVal.length > 0) {
        // Sanitise rows against itemSchema.
        out[f.key] = sanitiseArrayRows(agentVal, f.itemSchema || []);
        filled += 1;
      } else if (agentVal === null) {
        // Agent explicitly said "no rows" — accept as []
        out[f.key] = [];
      }
      continue;
    }

    // Non-array: skip if surveyor already typed something.
    const surveyorAlreadyFilled =
      existingVal !== undefined &&
      existingVal !== null &&
      String(existingVal).trim() !== '';
    if (surveyorAlreadyFilled) {
      skipped += 1;
      continue;
    }

    if (agentVal !== null && agentVal !== undefined && agentVal !== '') {
      out[f.key] = agentVal;
      filled += 1;
    }
  }

  return { merged: out, filled, skipped, dropped };
}

function sanitiseArrayRows(rows, itemSchema) {
  if (!Array.isArray(rows)) return [];
  if (!Array.isArray(itemSchema) || itemSchema.length === 0) return rows;
  const allowed = new Set(itemSchema.map((c) => c.key).filter(Boolean));
  return rows.map((r) => {
    if (!r || typeof r !== 'object') return {};
    const out = {};
    for (const col of itemSchema) {
      if (col && typeof col.key === 'string') {
        out[col.key] = Object.prototype.hasOwnProperty.call(r, col.key) ? r[col.key] : '';
      }
    }
    // Drop extra keys silently — they're not in the schema.
    return out;
  });
}

function truncate(s, max) {
  if (typeof s !== 'string') return '';
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`;
}

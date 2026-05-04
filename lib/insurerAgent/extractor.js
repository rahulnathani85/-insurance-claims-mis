// =============================================================================
// lib/insurerAgent/extractor.js
// =============================================================================
// Shared prompt + JSON-shape contract for the Insurer Registration Agent
// (/insurer-master/register). The same extractor is used by all 3 input
// modes (name, url, document) — each mode just feeds different "evidence"
// into the prompt, but the JSON schema and the field-confidence rubric
// are identical so the downstream Review screen renders the same shape.
//
// Why prompt-engineered JSON (not native JSON mode):
//   The portal's two LLM providers (lib/aiClients/providers/{claude,gemini}.js)
//   don't currently pass a response_schema / tool definition through. Adding
//   that would be its own multi-day refactor. Instead we follow the same
//   pattern as the existing claim-registration agent
//   (lib/comms/prompts/registrationAgentPrompt.js): explicit "JSON only, no
//   prose, no fences" instructions + a robust parser that strips ``` fences
//   if the model adds them anyway.
//
// Out of scope (per spec): Branch-level seeding. The agent only emits the 4
// hierarchy levels HO / RO / LCBO / ZO. Branches still come via XLSX bulk
// upload because LLMs hallucinate at the long tail.
// =============================================================================

// ---------------------------------------------------------------------------
// JSON schema (documentation-only — used for prompt construction).
// ---------------------------------------------------------------------------
//
// {
//   insurer: {
//     company_name:        string         (high|medium|low)
//     code:                string|null    (acronym, ALL CAPS, 2–6 chars)
//     irdai_reg_no:        string|null
//     gstin:               string|null    (15 chars; checksum verified by confidence.js)
//     ownership_type:      'PSU'|'Private'|'Standalone Health'|'Foreign Reinsurer'|null
//     registered_address:  string|null
//     city:                string|null    (head-office city)
//     state:               string|null    (head-office state)
//     pin:                 string|null    (head-office pin, 6 digits)
//     phone:               string|null
//     email:               string|null
//   },
//   offices: [
//     {
//       office_code:  'HO'|'RO'|'LCBO'|'ZO'    (NEVER RCH/CCH/BO at this stage)
//       name:         string
//       city:         string|null
//       state:        string|null
//       address:      string|null
//       parent_name:  string|null   (name of parent office in the same array;
//                                    used by the commit endpoint to wire
//                                    parent_office_id within the batch)
//     }
//   ],
//   field_confidences: {
//     "<dotted-path>": "high"|"medium"|"low"     // e.g. "insurer.gstin",
//                                                //      "offices[2].city"
//   },
//   extraction_notes: string|null   // freeform model commentary, surfaced
//                                   // verbatim in the Review screen sidebar.
// }
//
// ---------------------------------------------------------------------------

export const ALLOWED_OFFICE_CODES_AT_AGENT_STAGE = ['HO', 'RO', 'LCBO', 'ZO'];

export const ALLOWED_OWNERSHIP_TYPES = [
  'PSU',
  'Private',
  'Standalone Health',
  'Foreign Reinsurer',
];

export const SYSTEM_PROMPT = `You are the NISLA Insurer Registration Agent.

NISLA is an IRDAI-licensed surveyor firm registering an Indian insurance company in its master database. Your job is to extract structured registration data about the insurer and its top-level offices, ONLY.

You output JSON ONLY — no prose, no markdown, no code fences. Your response must parse with JSON.parse() on the first try. If you don't know a value, return null. Do NOT invent data.

HARD RULES:
1. Office hierarchy levels you may emit: HO, RO, LCBO, ZO.
   - HO  = Head Office (always exactly ONE per insurer; the registered office).
   - RO  = Regional Office (typically 1 per zone or large state cluster).
   - LCBO = Large / Corporate Branch Office (special-status branches).
   - ZO  = Zonal Office.
   You MUST NOT emit RCH, CCH, or BO. Branches are out of scope at this stage and will be added later via bulk import.
2. ownership_type, when set, must be one of exactly: ${ALLOWED_OWNERSHIP_TYPES.map((s) => '"' + s + '"').join(', ')}.
3. company_name must be the official registered name as it appears on IRDAI records (e.g. "ICICI Lombard General Insurance Company Limited"). NOT a brand name (e.g. NOT "ICICI Lombard").
4. code is the 2–6 character all-caps acronym used informally (e.g. "ICICI", "NIA", "OIC"). Null if not obvious.
5. gstin is exactly 15 characters when present. Format: 2 digits + 10 chars (PAN) + 1 digit + 1 char + 1 alphanumeric. Return null if you can't extract 15 valid chars.
6. pin is exactly 6 digits.
7. For each office, parent_name should reference another office's name in the SAME offices array (or null for HO). Use the exact same string you used as that office's name field. The downstream commit step matches by exact string.
8. field_confidences entries must use dotted paths: "insurer.<field>" or "offices[<index>].<field>". Confidence levels: "high" (you have direct evidence in the input), "medium" (inferred but plausible), "low" (guess based on prior knowledge).

Output ONLY a valid JSON object with the shape:
{
  "insurer": { ... },
  "offices": [ ... ],
  "field_confidences": { ... },
  "extraction_notes": null
}`;

// ---------------------------------------------------------------------------
// buildLookupPrompt({ mode, name, url, htmlText, ocrText, xlsxRows })
//
// Returns: { systemPrompt, userMessage }
//
// Each mode supplies its evidence; the same system prompt drives the shape.
// ---------------------------------------------------------------------------

export function buildLookupPrompt({
  mode,
  name = null,
  url = null,
  htmlText = null,
  ocrText = null,
  xlsxRows = null,
} = {}) {
  let evidence;
  switch (mode) {
    case 'name':
      evidence =
        `INPUT MODE: insurer name search.\n\n` +
        `The user has typed the following name. Use your prior knowledge of Indian general insurance market to populate the schema. ` +
        `Mark every value as "medium" or "low" confidence — there is no document or web evidence in this mode, so "high" is not allowed.\n\n` +
        `Search term: ${JSON.stringify(name || '')}`;
      break;

    case 'url':
      evidence =
        `INPUT MODE: URL extraction.\n\n` +
        `The text below is the rendered (script-stripped) content of the URL: ${JSON.stringify(url || '')}.\n` +
        `Pull insurer + office data ONLY from this content. If a value is not in the page, return null — do NOT supplement with prior knowledge.\n\n` +
        `--- BEGIN PAGE TEXT ---\n` +
        truncate(htmlText || '', 25000) +
        `\n--- END PAGE TEXT ---`;
      break;

    case 'document':
      // Either OCR text (PDF/image) or normalised xlsx rows. The prompt
      // shape is the same — the model treats it as evidence to extract from.
      if (xlsxRows && Array.isArray(xlsxRows) && xlsxRows.length > 0) {
        evidence =
          `INPUT MODE: spreadsheet upload.\n\n` +
          `The rows below come from an XLSX the user uploaded. Each row is one office. ` +
          `Map column headers liberally (e.g. "Branch Name" → office.name, "Office Type" → office_code). ` +
          `Reject any row whose office_code maps to RCH/CCH/BO — those are branches, not in scope. ` +
          `Insurer-level fields (gstin, irdai_reg_no, ownership_type) should be left null unless explicitly present.\n\n` +
          `--- BEGIN ROWS (JSON) ---\n` +
          JSON.stringify(xlsxRows.slice(0, 200), null, 2) +
          `\n--- END ROWS ---`;
      } else {
        evidence =
          `INPUT MODE: document OCR.\n\n` +
          `The text below was extracted by OCR from a PDF or image the user uploaded. ` +
          `Pull insurer + office data ONLY from this content.\n\n` +
          `--- BEGIN OCR TEXT ---\n` +
          truncate(ocrText || '', 25000) +
          `\n--- END OCR TEXT ---`;
      }
      break;

    default:
      throw new Error(`buildLookupPrompt: unknown mode "${mode}"`);
  }

  return {
    systemPrompt: SYSTEM_PROMPT,
    userMessage: evidence,
  };
}

// ---------------------------------------------------------------------------
// parseInsurerJson(text)
//
// Strips markdown fences if the model added them, parses, validates the
// top-level shape, and clamps office_code values to the allowed-at-this-stage
// list. Throws on hard parse failure.
// ---------------------------------------------------------------------------

export function parseInsurerJson(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('empty LLM response');
  }
  const stripped = stripCodeFences(text).trim();

  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    // Last-ditch: find the first {...} block and try again. Some models add
    // a stray "Here's the JSON:" preamble despite instructions.
    const m = stripped.match(/\{[\s\S]*\}\s*$/);
    if (!m) throw new Error(`could not parse JSON: ${err.message}`);
    parsed = JSON.parse(m[0]);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('parsed value is not an object');
  }
  if (!parsed.insurer || typeof parsed.insurer !== 'object') {
    throw new Error('missing or invalid "insurer" field');
  }
  if (!Array.isArray(parsed.offices)) parsed.offices = [];

  // Clamp ownership_type.
  if (
    parsed.insurer.ownership_type &&
    !ALLOWED_OWNERSHIP_TYPES.includes(parsed.insurer.ownership_type)
  ) {
    parsed.insurer.ownership_type = null;
  }

  // Filter offices to allowed codes; clamp anything weird.
  parsed.offices = parsed.offices
    .map(normaliseOffice)
    .filter((o) => o && ALLOWED_OFFICE_CODES_AT_AGENT_STAGE.includes(o.office_code));

  // Field confidences default.
  if (!parsed.field_confidences || typeof parsed.field_confidences !== 'object') {
    parsed.field_confidences = {};
  }
  if (parsed.extraction_notes && typeof parsed.extraction_notes !== 'string') {
    parsed.extraction_notes = null;
  }

  return parsed;
}

function normaliseOffice(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const code = String(raw.office_code || raw.code || raw.type || '').toUpperCase().trim();
  const name = String(raw.name || '').trim();
  if (!code || !name) return null;
  return {
    office_code: code,
    name,
    city: nullify(raw.city),
    state: nullify(raw.state),
    address: nullify(raw.address),
    parent_name: nullify(raw.parent_name) || nullify(raw.parent),
  };
}

function nullify(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function stripCodeFences(s) {
  // Handle ```json ... ```, ``` ... ```, and bare leading/trailing fences.
  return s
    .replace(/^\s*```(?:json|JSON)?\s*\n/, '')
    .replace(/\n\s*```\s*$/, '')
    .replace(/^\s*```\s*/, '')
    .replace(/\s*```\s*$/, '');
}

function truncate(s, max) {
  if (typeof s !== 'string') return '';
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`;
}

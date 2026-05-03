// =============================================================================
// lib/registrationDraft.js
// =============================================================================
// Pure helpers for the 3-column registration UI (Slice E, spec §8).
//
// Concerns:
//   1. CONFIDENCE_BANDS — how to render the colour cue next to AI-prefilled
//      fields (spec: green ≥0.85, amber 0.6–0.85, red <0.6).
//   2. fieldConfidenceFromExtraction — looks up a per-field confidence in
//      the LLM's extracted_data jsonb. Tolerates missing values.
//   3. mergeDraftWithClaim — produces the initial form state by overlaying
//      the saved draft on top of the source claim row.
//   4. summariseDraft — surfaces 'how complete is this draft' for the
//      submit-disabled gate.
// =============================================================================

// -----------------------------------------------------------------------------
// Confidence bands (spec §2)
// -----------------------------------------------------------------------------

export const CONFIDENCE_BANDS = {
  high:    { min: 0.85, label: 'High',     color: '#15803d', bg: '#dcfce7' },
  medium:  { min: 0.6,  label: 'Medium',   color: '#b45309', bg: '#fef3c7' },
  low:     { min: 0,    label: 'Low',      color: '#b91c1c', bg: '#fee2e2' },
};

export function confidenceBand(value) {
  if (value === null || value === undefined) return 'unknown';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'unknown';
  if (n >= CONFIDENCE_BANDS.high.min) return 'high';
  if (n >= CONFIDENCE_BANDS.medium.min) return 'medium';
  return 'low';
}

// -----------------------------------------------------------------------------
// Look up a field's confidence in the LLM extraction blob.
//
// Several shapes are common in the wild:
//   { policy_number: 'XYZ', _confidence: { policy_number: 0.92 } }
//   { policy_number: { value: 'XYZ', confidence: 0.92 } }
//   { policy_number: 'XYZ' }   // no confidence
//
// We accept any of those and return:
//   { value, confidence }   // confidence may be null
// -----------------------------------------------------------------------------

export function fieldFromExtraction(extracted, fieldName) {
  if (!extracted || typeof extracted !== 'object' || !fieldName) {
    return { value: null, confidence: null };
  }

  const direct = extracted[fieldName];

  // Shape 1: { value, confidence } object
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    if ('value' in direct) {
      const conf = direct.confidence ?? direct._confidence;
      return {
        value: direct.value ?? null,
        confidence: conf === null || conf === undefined ? null : Number(conf),
      };
    }
  }

  // Shape 2: sibling _confidence map
  if (direct !== undefined) {
    const confMap = extracted._confidence || extracted.__confidence || {};
    const conf = confMap[fieldName];
    return {
      value: direct ?? null,
      confidence: conf === null || conf === undefined ? null : Number(conf),
    };
  }

  return { value: null, confidence: null };
}

// -----------------------------------------------------------------------------
// Merge a saved draft over the source claim. Saved draft wins.
// Used to seed form state on page load.
// -----------------------------------------------------------------------------

const FORM_FIELDS = [
  'ref_number',
  'insurer_name', 'insurer_branch', 'dealing_officer_name', 'dealing_officer_email', 'dealing_officer_phone',
  'policy_number', 'policy_period_from', 'policy_period_to', 'sum_insured', 'policy_type',
  'insured_name', 'insured_address', 'insured_contact_phone', 'insured_contact_email', 'insured_gstin',
  'lob', 'lob_subcategory', 'peril_type', 'date_loss', 'date_of_intimation',
  'loss_location', 'loss_location_pin', 'loss_location_state', 'loss_location_district',
  'loss_location_lat', 'loss_location_lng',
  'estimated_loss_amount', 'gross_loss', 'claim_amount_intimated',
  'complexity_tier', 'is_catastrophe',
  'fee_basis', 'fee_amount', 'fee_notes',
  'remark',
];

export function mergeDraftWithClaim(claim = {}, draftData = {}) {
  const out = {};
  for (const f of FORM_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(draftData, f)) {
      out[f] = draftData[f];
    } else if (claim[f] !== undefined) {
      out[f] = claim[f];
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// summariseDraft — light progress indicator for the form footer.
// Returns: {
//   total: number,         // mandatory fields
//   filled: number,        // mandatory fields with non-empty values
//   missing: string[],     // mandatory field names still empty
//   ready: boolean,        // ok to submit?
// }
// -----------------------------------------------------------------------------

const MANDATORY_FIELDS = [
  'insurer_name',
  'policy_number',
  'policy_period_from',
  'policy_period_to',
  'sum_insured',
  'insured_name',
  'lob',
  'date_loss',
  'date_of_intimation',
  'loss_location',
  'loss_location_pin',
];

export function summariseDraft(formState = {}) {
  const missing = [];
  for (const f of MANDATORY_FIELDS) {
    const v = formState[f];
    if (v === undefined || v === null) {
      missing.push(f);
      continue;
    }
    if (typeof v === 'string' && v.trim() === '') {
      missing.push(f);
      continue;
    }
    if (typeof v === 'number' && !Number.isFinite(v)) {
      missing.push(f);
    }
  }
  return {
    total: MANDATORY_FIELDS.length,
    filled: MANDATORY_FIELDS.length - missing.length,
    missing,
    ready: missing.length === 0,
  };
}

// -----------------------------------------------------------------------------
// Has the form changed enough to warrant an autosave?
// Used to suppress no-op writes from the debounced save loop.
// -----------------------------------------------------------------------------

export function hasMeaningfulDiff(prev, next) {
  if (prev === next) return false;
  if (!prev) return true;
  // Shallow equality is enough — the form state is flat strings/numbers.
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  for (const k of keys) {
    const a = prev?.[k];
    const b = next?.[k];
    if ((a ?? null) !== (b ?? null)) return true;
  }
  return false;
}

export { FORM_FIELDS, MANDATORY_FIELDS };

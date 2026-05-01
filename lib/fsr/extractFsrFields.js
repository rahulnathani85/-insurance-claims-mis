// =============================================================================
// lib/fsr/extractFsrFields.js
// =============================================================================
// Slices an FSR-relevant subset out of a claim JSON. Ported from
// nisla-ai-pack/lib/cache/extractFsrFields.js (CommonJS → ES module).
//
// Inputs:  claimData (nested AI-pack shape — camelCase, marine/warranty),
//          lob ('MARINE' | 'EXT_WARRANTY')
// Outputs: {
//   flat:         { 'policy.policyNo': '...', ... },
//   nested:       { ...sliced... },
//   missing:      ['marine.voyage.containerNo'],   // required + missing
//   populated:    23,
//   total:        30,
//   completeness: 0.77,
// }
//
// Used by:
//   - The validation layer (lib/fsr/validationRules.js consumes the nested
//     shape; this helper accepts the same shape).
//   - The FSR completeness widget on the surveyor portal (renders
//     `populated / total` and the list of missing required fields).
//   - The narrative-drafting AI prompt (lib/fsr/draftNarrativePrompt.js
//     embeds `nested` to give Claude exactly the FSR-relevant subset
//     rather than the entire claim row).
//
// Note: this is the AI-pack's nested shape. The portal's flat `claims` row
// shape is converted on-the-fly by `claimRowToPackShape` (below).
// =============================================================================

import { fieldsFor } from './fieldMap.js';

// -----------------------------------------------------------------------------
// path utilities
// -----------------------------------------------------------------------------

export function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setByPath(obj, path, value) {
  const keys = path.split('.');
  let cursor = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cursor[keys[i]] == null || typeof cursor[keys[i]] !== 'object') {
      cursor[keys[i]] = {};
    }
    cursor = cursor[keys[i]];
  }
  cursor[keys[keys.length - 1]] = value;
}

function isEmpty(v) {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

// -----------------------------------------------------------------------------
// extractFsrFields — main entry
// -----------------------------------------------------------------------------

export function extractFsrFields(claimData, lob) {
  const fields = fieldsFor(lob);
  const flat = {};
  const nested = {};
  const missing = [];
  let populated = 0;

  for (const f of fields) {
    const v = getByPath(claimData, f.path);
    flat[f.path] = v ?? null;
    if (!isEmpty(v)) {
      setByPath(nested, f.path, v);
      populated++;
    } else if (f.required) {
      missing.push(f.path);
    }
  }

  // Carry over annexures + narrative if present (not in field list but FSR needs them)
  if (Array.isArray(claimData?.annexures)) nested.annexures = claimData.annexures;
  if (claimData?.narrative) nested.narrative = claimData.narrative;

  return {
    flat,
    nested,
    missing,
    populated,
    total: fields.length,
    completeness: fields.length ? populated / fields.length : 0,
  };
}

// -----------------------------------------------------------------------------
// applyFlatPatch — merge { 'a.b.c': value, ... } into a nested claim
// -----------------------------------------------------------------------------

export function applyFlatPatch(claimData, flatPatch) {
  const next = JSON.parse(JSON.stringify(claimData || {}));
  for (const [path, value] of Object.entries(flatPatch)) {
    setByPath(next, path, value);
  }
  return next;
}

// -----------------------------------------------------------------------------
// claimRowToPackShape — convert a portal `claims` row into the AI-pack's
// nested shape so the validation rules / extraction helpers can run against
// it. Lossy: only fields the AI pack cares about are mapped.
//
// Anything LOB-specific (Marine voyage, EW warranty block) must come from
// either `claim.data` (if the OCR pipeline already populated it) or from
// the LOB-specific tables (marine_loss_sheets, ew_vehicle_claims).
// -----------------------------------------------------------------------------

export function claimRowToPackShape(claim, opts = {}) {
  if (!claim) return null;
  const lobMap = {
    'Marine Cargo': 'MARINE',
    'Marine Hull':  'MARINE',
    'Extended Warranty': 'EXT_WARRANTY',
  };
  const packLob = lobMap[claim.lob] || null;

  const shape = {
    claimNo:          claim.claim_number || claim.ref_number || '',
    insurer:          claim.insurer_name || '',
    insured:          claim.insured_name || '',
    dateOfIntimation: toIsoDate(claim.date_of_intimation),
    dateOfLoss:       toIsoDate(claim.date_loss),
    dateOfSurvey:     toIsoDate(claim.registered_at),
    placeOfLoss:      claim.loss_location || '',
    reportType:       opts.reportType || 'FINAL',
    policy: {
      policyNo:   claim.policy_number || '',
      fromDate:   toIsoDate(claim.policy_period_from),
      toDate:     toIsoDate(claim.policy_period_to),
      sumInsured: Number(claim.sum_insured || opts.sumInsured || 0),
      currency:   'INR',
      excess:     Number(opts.excess || 0),
    },
    surveyor: opts.surveyor || {
      name: opts.signerName || '',
      slaNo: opts.signerLicense || '',
      category: opts.signerCategory || 'A',
    },
    annexures: opts.annexures || [],
  };

  // Merge any data that the OCR pipeline may have already nested under claim.data
  if (claim.data && typeof claim.data === 'object') {
    if (claim.data.marine)   shape.marine = claim.data.marine;
    if (claim.data.warranty) shape.warranty = claim.data.warranty;
    if (claim.data.computation) shape.computation = claim.data.computation;
    if (claim.data.narrative)   shape.narrative = claim.data.narrative;
    if (Array.isArray(claim.data.annexures)) shape.annexures = claim.data.annexures;
  }

  // Computation defaults — the validator wants gross + net even if 0
  if (!shape.computation) {
    shape.computation = {
      grossLoss: Number(claim.gross_loss || 0),
      netAdjustedLoss: Number(claim.gross_loss || 0),
    };
  }

  return { lob: packLob, shape };
}

function toIsoDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10);
}

// =============================================================================
// lib/fsr/validationRules.js
// =============================================================================
// FSR / ILA business-rule validation. Ported from
// nisla-ai-pack/lib/validation-rules.js (CommonJS → ES module).
//
// The original used `ajv` + `ajv-formats` + `dayjs`. To keep the portal
// dep tree lean we reimplemented:
//   - JSON-schema validation as a tiny structural walker (`validateAgainstSchema`)
//     that handles only the features the schemas use: type, required,
//     properties, items, enum, minLength, minimum, format=date.
//   - dayjs date math via native `Date` plus the `daysBetween` helper.
//
// Two-layer validation (same as the pack):
//   Layer 1 — schema (structural / mandatory fields)
//   Layer 2 — business rules per LOB (IRDAI / underwriting checks)
//
// Usage:
//   import { validateClaim } from '@/lib/fsr/validationRules';
//   const result = validateClaim(claimJson);
//   if (!result.ok) { /* show result.errors */ }
//
// `claimJson` is the AI-pack's nested shape (camelCase, marine/warranty
// blocks). Use lib/fsr/extractFsrFields to convert to/from that shape if
// the input comes from the portal's flat `claims` row.
// =============================================================================

import { marineSchema, extWarrantySchema } from './schemas.js';

// -----------------------------------------------------------------------------
// Tiny JSON-schema walker — covers exactly the subset the schemas use.
// -----------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function validateAgainstSchema(value, schema, path = '') {
  const errors = [];

  if (!schema) return errors;

  // Required keys check (object)
  if (schema.type === 'object' && schema.required) {
    for (const key of schema.required) {
      const v = value?.[key];
      if (v === undefined || v === null || v === '') {
        errors.push({
          code: 'SCHEMA_ERROR',
          field: path ? `${path}.${key}` : key,
          message: `${path ? path + '.' : ''}${key} is required`,
        });
      }
    }
  }

  if (value === undefined || value === null) return errors;

  // Type check
  if (schema.type) {
    const got = typeOf(value);
    const want = schema.type;
    if (got !== want) {
      // number / integer leniency: accept numeric strings? No — keep strict.
      errors.push({
        code: 'SCHEMA_ERROR',
        field: path,
        message: `${path || '(root)'} expected ${want}, got ${got}`,
      });
      return errors;  // type mismatch — don't recurse
    }
  }

  // string constraints
  if (schema.type === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push({ code: 'SCHEMA_ERROR', field: path, message: `${path} must be at least ${schema.minLength} chars` });
    }
    if (schema.format === 'date' && !ISO_DATE_RE.test(value)) {
      errors.push({ code: 'SCHEMA_ERROR', field: path, message: `${path} must be an ISO date (YYYY-MM-DD)` });
    }
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push({ code: 'SCHEMA_ERROR', field: path, message: `${path} must be one of ${schema.enum.join(', ')}` });
    }
  }

  // number constraints
  if (schema.type === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push({ code: 'SCHEMA_ERROR', field: path, message: `${path} must be ≥ ${schema.minimum}` });
    }
  }

  // object — recurse into properties
  if (schema.type === 'object' && schema.properties) {
    for (const key of Object.keys(schema.properties)) {
      const subValue = value?.[key];
      if (subValue === undefined) continue;  // optional and missing → skip
      const subPath = path ? `${path}.${key}` : key;
      errors.push(...validateAgainstSchema(subValue, schema.properties[key], subPath));
    }
  }

  // array — recurse into items
  if (schema.type === 'array' && schema.items) {
    for (let i = 0; i < value.length; i++) {
      errors.push(...validateAgainstSchema(value[i], schema.items, `${path}[${i}]`));
    }
  }

  return errors;
}

// -----------------------------------------------------------------------------
// Date helpers (replace dayjs)
// -----------------------------------------------------------------------------

function toMs(d) {
  if (!d) return NaN;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function isBetween(d, from, to) {
  const t = toMs(d);
  const f = toMs(from);
  const e = toMs(to);
  if (!Number.isFinite(t) || !Number.isFinite(f) || !Number.isFinite(e)) return false;
  // Be inclusive on both ends; tolerate wall-clock-vs-IST timezone slop by
  // widening by 1 day on either side.
  const ONE_DAY = 24 * 60 * 60 * 1000;
  return t >= f - ONE_DAY && t <= e + ONE_DAY;
}

function isAfter(a, b) {
  const ta = toMs(a); const tb = toMs(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return ta > tb;
}

function isBefore(a, b) {
  const ta = toMs(a); const tb = toMs(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return ta < tb;
}

// -----------------------------------------------------------------------------
// LOB-specific business rules
// -----------------------------------------------------------------------------

const marineBusinessRules = [
  // Loss date must fall within policy period
  (c) => !isBetween(c.dateOfLoss, c.policy.fromDate, c.policy.toDate)
    && { code: 'LOSS_OUTSIDE_POLICY', field: 'dateOfLoss',
         message: 'Date of loss is outside the policy period' },

  // Sailing date should not be after loss date
  (c) => isAfter(c.marine?.voyage?.sailingDate, c.dateOfLoss)
    && { code: 'SAILING_AFTER_LOSS', field: 'marine.voyage.sailingDate',
         message: 'Sailing date cannot be after the date of loss' },

  // Arrival, if provided, should not be before sailing
  (c) => c.marine?.voyage?.arrivalDate
    && isBefore(c.marine.voyage.arrivalDate, c.marine.voyage.sailingDate)
    && { code: 'ARRIVAL_BEFORE_SAILING', field: 'marine.voyage.arrivalDate',
         message: 'Arrival date is before sailing date' },

  // ICC C does not cover theft / water damage etc. — flag for review
  (c) => c.marine?.iccClause === 'C'
    && /theft|water|wet/i.test(c.marine?.causeOfLoss || '')
    && { code: 'ICC_C_PERIL_REVIEW', field: 'marine.iccClause',
         message: 'Cause of loss may not be admissible under ICC(C). Senior review required.' },

  // Net adjusted loss cannot exceed Sum Insured
  (c) => c.computation.netAdjustedLoss > c.policy.sumInsured
    && { code: 'LOSS_EXCEEDS_SI', field: 'computation.netAdjustedLoss',
         message: 'Net adjusted loss exceeds sum insured' },

  // Computation arithmetic: gross − all deductions ≈ net
  (c) => {
    const calc = (c.computation.grossLoss || 0)
               - (c.computation.lessSalvage || 0)
               - (c.computation.lessDepreciation || 0)
               - (c.computation.lessUnderInsurance || 0)
               - (c.computation.lessExcess || 0);
    return Math.abs(calc - c.computation.netAdjustedLoss) > 1
      && { code: 'COMPUTATION_MISMATCH', field: 'computation',
           message: `Net loss arithmetic mismatch. Calculated ${calc}, entered ${c.computation.netAdjustedLoss}` };
  },

  // FINAL report needs minimum mandatory annexures
  (c) => c.reportType === 'FINAL'
    && (!c.annexures || c.annexures.length < 3)
    && { code: 'MIN_ANNEXURES', field: 'annexures',
         message: 'Final report must have at least 3 annexures (invoice, packing list, photos)' },

  // Surveyor category vs claim value (IRDAI authorisation)
  (c) => c.surveyor.category === 'C' && c.computation.netAdjustedLoss > 1500000
    && { code: 'SURVEYOR_CAT_INSUFFICIENT', field: 'surveyor.category',
         message: 'Category C surveyor cannot sign claims above ₹15 lakh' },
];

const warrantyBusinessRules = [
  // Failure must be inside extended warranty period
  (c) => !isBetween(
        c.warranty?.failure?.dateOfFailure,
        c.warranty?.extendedWarranty?.fromDate,
        c.warranty?.extendedWarranty?.toDate,
      )
    && { code: 'FAILURE_OUTSIDE_EW', field: 'warranty.failure.dateOfFailure',
         message: 'Date of failure is outside the extended warranty period' },

  // Extended warranty should start on/after manufacturer warranty expires (no overlap)
  (c) => isBefore(c.warranty?.extendedWarranty?.fromDate, c.warranty?.manufacturerWarranty?.toDate)
    && { code: 'EW_OVERLAPS_MFG', field: 'warranty.extendedWarranty.fromDate',
         message: 'Extended warranty starts before manufacturer warranty ends. Manufacturer is liable for this period.' },

  // Loss date should equal date of failure (sanity check)
  (c) => c.dateOfLoss !== c.warranty?.failure?.dateOfFailure
    && { code: 'LOSS_FAILURE_DATE_MISMATCH', field: 'dateOfLoss',
         message: 'Date of loss does not match date of equipment failure' },

  // Standard exclusions trigger non-admissibility flags
  (c) => c.warranty?.failure?.wearAndTear
    && { code: 'EXCL_WEAR_TEAR', field: 'warranty.failure.wearAndTear',
         message: 'Wear & tear is excluded under extended warranty. Mark Not Admissible.' },

  (c) => c.warranty?.failure?.unauthorisedRepair
    && { code: 'EXCL_UNAUTH_REPAIR', field: 'warranty.failure.unauthorisedRepair',
         message: 'Unauthorised repair voids warranty. Mark Not Admissible.' },

  (c) => c.warranty?.failure?.misuse
    && { code: 'EXCL_MISUSE', field: 'warranty.failure.misuse',
         message: 'Misuse / negligence is excluded. Mark Not Admissible.' },

  (c) => c.warranty?.failure?.preExistingDamage
    && { code: 'EXCL_PRE_EXISTING', field: 'warranty.failure.preExistingDamage',
         message: 'Pre-existing damage is excluded.' },

  // PARTS_ONLY plan: labour cost should not be claimed
  (c) => c.warranty?.extendedWarranty?.planType === 'PARTS_ONLY'
    && (c.computation.labourCost || 0) > 0
    && { code: 'LABOUR_NOT_COVERED', field: 'computation.labourCost',
         message: 'Plan covers parts only. Labour cost is not admissible.' },

  // LABOUR_ONLY plan: parts cost should not be claimed
  (c) => c.warranty?.extendedWarranty?.planType === 'LABOUR_ONLY'
    && (c.computation.partsCost || 0) > 0
    && { code: 'PARTS_NOT_COVERED', field: 'computation.partsCost',
         message: 'Plan covers labour only. Parts cost is not admissible.' },

  // BER (beyond economic repair) — replacement cost capped at SI / equipment value
  (c) => c.warranty?.repairOrReplace === 'BER'
    && c.computation.grossLoss > (c.warranty?.equipment?.invoiceValue || c.policy.sumInsured)
    && { code: 'BER_EXCEEDS_VALUE', field: 'computation.grossLoss',
         message: 'BER replacement cost exceeds equipment / sum insured value' },

  // Net loss within Sum Insured
  (c) => c.computation.netAdjustedLoss > c.policy.sumInsured
    && { code: 'LOSS_EXCEEDS_SI', field: 'computation.netAdjustedLoss',
         message: 'Net adjusted loss exceeds sum insured' },

  // Computation arithmetic
  (c) => {
    const calc = (c.computation.grossLoss || 0)
               - (c.computation.lessDepreciation || 0)
               - (c.computation.lessSalvage || 0)
               - (c.computation.lessExcess || 0);
    return Math.abs(calc - c.computation.netAdjustedLoss) > 1
      && { code: 'COMPUTATION_MISMATCH', field: 'computation',
           message: `Net loss arithmetic mismatch. Calculated ${calc}, entered ${c.computation.netAdjustedLoss}` };
  },
];

// -----------------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------------

function runRules(rules, claim) {
  const errors = [];
  for (const rule of rules) {
    try {
      const r = rule(claim);
      if (r) errors.push(r);
    } catch (e) {
      errors.push({ code: 'RULE_EXCEPTION', message: e.message });
    }
  }
  return errors;
}

export function validateClaim(claim) {
  // Pick LOB by detecting the body block
  const lob = claim?.marine ? 'MARINE'
            : claim?.warranty ? 'EXT_WARRANTY'
            : null;

  if (!lob) {
    return {
      ok: false,
      errors: [{ code: 'UNKNOWN_LOB', message: 'Claim must contain "marine" or "warranty" block' }],
    };
  }

  const schema = lob === 'MARINE' ? marineSchema : extWarrantySchema;
  const businessRules = lob === 'MARINE' ? marineBusinessRules : warrantyBusinessRules;

  const errors = [];

  // Layer 1 — schema
  errors.push(...validateAgainstSchema(claim, schema));

  // Layer 2 — business rules (only if schema mostly OK to avoid noise)
  if (errors.length === 0) {
    errors.push(...runRules(businessRules, claim));
  }

  return { ok: errors.length === 0, lob, errors };
}

// Exposed for tests
export const __internals = {
  validateAgainstSchema,
  isBetween,
  isAfter,
  isBefore,
  marineBusinessRules,
  warrantyBusinessRules,
};

// ============================================================
// lib/comms/extractors/validators.js
// ------------------------------------------------------------
// Shared primitive validators used by per-tag extractors.
//
// Philosophy:
//   - We trust the classifier to put the right SHAPE in the
//     right keys; validators coerce to strings, trim whitespace,
//     normalize ISO dates, and collect per-field error messages.
//   - "invalid" extractions are still persisted — is_valid is
//     written to extraction_results and validation_errors captures
//     the per-field problems so ops can review in Week 3.
//   - We never throw; we return a structured result.
// ============================================================

const TRUTHY_EMPTY = new Set(['', 'null', 'undefined', 'n/a', 'na', '-']);

export function normString(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (TRUTHY_EMPTY.has(s.toLowerCase())) return '';
  return s;
}

export function normIsoDate(raw) {
  const s = normString(raw);
  if (!s) return '';
  // Already ISO 8601-ish?
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  // Try Date.parse for "14 March 2026", "14/03/2026", etc.
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  return s; // return as-is; validator will flag invalid below
}

export function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ------------------------------------------------------------
// validateAgainstSchema(extracted, schema)
// Generic pass-through validator for the seeded JSON schemas.
// Returns { data, errors, isValid }.
//
// Rules applied per field:
//   - type 'string'  : coerce to trimmed string
//   - type 'date'    : coerce to YYYY-MM-DD; required => must match ISO
//   - type 'integer' : coerce to int; required => must be finite integer
//   - type 'enum'    : coerce to trimmed string (value space unenforced
//                      at the DB layer; ops can tighten later)
//   - required=true  : empty value is an error
// ------------------------------------------------------------
export function validateAgainstSchema(extracted, schema) {
  const data = {};
  const errors = [];

  const input = extracted && typeof extracted === 'object' ? extracted : {};

  for (const [key, spec] of Object.entries(schema || {})) {
    const type = spec?.type || 'string';
    const required = spec?.required === true;
    const raw = input[key];

    let value;
    switch (type) {
      case 'date': {
        value = normIsoDate(raw);
        if (required && !isIsoDate(value)) {
          errors.push({ field: key, error: 'required_date_missing_or_invalid' });
        }
        break;
      }
      case 'integer': {
        const s = normString(raw);
        const n = s === '' ? NaN : Number(s);
        if (Number.isFinite(n) && Number.isInteger(n)) {
          value = n;
        } else {
          value = null;
          if (required) {
            errors.push({ field: key, error: 'required_integer_missing_or_invalid' });
          }
        }
        break;
      }
      case 'enum':
      case 'string':
      default: {
        value = normString(raw);
        if (required && !value) {
          errors.push({ field: key, error: 'required_field_missing' });
        }
        break;
      }
    }

    data[key] = value;
  }

  return {
    data,
    errors,
    isValid: errors.length === 0,
  };
}

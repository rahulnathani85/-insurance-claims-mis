// ============================================================
// lib/comms/extractors/intimation.js
// ------------------------------------------------------------
// Extractor + validator for the 'intimation' workflow tag.
//
// Schema (from migration_comms_3_tag_seeds.sql):
//   policy_no            string  required
//   insured_name         string  required
//   vehicle_or_property  string  required
//   date_of_loss         date    required   — ISO 8601
//   location             string  required
//   contact              string  optional
//   sum_insured          string  optional
//   lob                  enum    required   — Motor OD / Fire / Marine / Health / etc.
//
// On top of the generic schema pass we do a few domain-specific
// sanity checks:
//   - policy_no: has at least one digit (policy numbers always do)
//   - date_of_loss: not in the future (a future DOL is almost
//     certainly a parse error; flag but don't drop)
//   - lob: warn when the string doesn't contain one of the well-
//     known LOB keywords. Not fatal — Indian insurers use many
//     local codes.
// ============================================================

import { validateAgainstSchema, isIsoDate } from './validators';

const LOB_KEYWORDS = [
  'motor', 'auto', 'vehicle',       // motor OD / TP
  'fire', 'bharat', 'property',
  'marine', 'cargo', 'hull',
  'health', 'mediclaim', 'hospital',
  'engineering', 'erection', 'machinery',
  'liability', 'workmen', 'wc',
  'personal accident', 'pa',
  'burglary', 'jewellers',
];

// Intimation extraction schema mirror (kept in code so the
// extractor is standalone if the DB row is unreachable).
// This MUST match the tag_definitions row for 'intimation'.
const INTIMATION_SCHEMA = {
  policy_no:          { type: 'string', required: true },
  insured_name:       { type: 'string', required: true },
  vehicle_or_property:{ type: 'string', required: true },
  date_of_loss:       { type: 'date',   required: true },
  location:           { type: 'string', required: true },
  contact:            { type: 'string', required: false },
  sum_insured:        { type: 'string', required: false },
  lob:                { type: 'enum',   required: true },
};

export function extractIntimation(extracted) {
  const base = validateAgainstSchema(extracted, INTIMATION_SCHEMA);
  const errors = [...base.errors];
  const data = { ...base.data };

  // policy_no must contain a digit
  if (data.policy_no && !/\d/.test(data.policy_no)) {
    errors.push({ field: 'policy_no', error: 'no_digits_in_policy_number' });
  }

  // date_of_loss should not be in the future
  if (isIsoDate(data.date_of_loss)) {
    const dol = Date.parse(data.date_of_loss);
    if (Number.isFinite(dol) && dol > Date.now() + 24 * 60 * 60 * 1000) {
      errors.push({ field: 'date_of_loss', error: 'date_in_future' });
    }
  }

  // lob soft check
  if (data.lob) {
    const low = data.lob.toLowerCase();
    const known = LOB_KEYWORDS.some((kw) => low.includes(kw));
    if (!known) {
      errors.push({ field: 'lob', error: 'unknown_line_of_business', severity: 'warn' });
    }
  }

  // isValid is "all non-warn errors"
  const nonWarn = errors.filter((e) => e.severity !== 'warn');
  return { data, errors, isValid: nonWarn.length === 0 };
}

// Exported for tests / introspection
export const intimationSchema = INTIMATION_SCHEMA;

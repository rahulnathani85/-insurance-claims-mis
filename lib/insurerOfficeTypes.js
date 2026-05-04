// =============================================================================
// lib/insurerOfficeTypes.js
// =============================================================================
// Single source of truth for the insurer-office hierarchy on the JS side.
// The DB enforces the same shape (CHECK constraint + parent FK + partial
// unique on HO per insurer) but the API + UI need the rules client-side too:
//   - to drive the office-type select in the form
//   - to filter the parent-office picker to legal options
//   - to validate before submit so the user gets a friendly error instead
//     of a Postgres CHECK violation
//   - to render the colored type badge in the office list
//
// Hierarchy:
//   HO   - root, no parent
//   RO   - parent = HO
//   LCBO - parent = HO
//   ZO   - parent = HO
//   RCH  - parent = RO or ZO
//   CCH  - parent = RCH
//   BO   - parent = RO or ZO or RCH or CCH or LCBO
//
// HO is a singleton per insurer (one Head Office) — enforced server-side
// via a partial UNIQUE index, validated client-side via OFFICE_TYPE_IS_SINGLETON.
// =============================================================================

// ----- Office codes (the 7-value enum stored in insurer_offices.office_code) -----
export const OFFICE_CODES = Object.freeze({
  HO:   'HO',
  RO:   'RO',
  LCBO: 'LCBO',
  ZO:   'ZO',
  RCH:  'RCH',
  CCH:  'CCH',
  BO:   'BO',
});

// Plain array form for `.includes()` checks and select options.
export const OFFICE_CODE_LIST = Object.freeze(Object.values(OFFICE_CODES));

// ----- Human-readable labels -----
// OFFICE_TYPE_LABELS — full label used in form selects, table cells.
export const OFFICE_TYPE_LABELS = Object.freeze({
  HO:   'Head Office',
  RO:   'Regional Office',
  LCBO: 'Large / Corporate Branch Office',
  ZO:   'Zonal Office',
  RCH:  'Regional Claims Hub',
  CCH:  'Corporate Claims Hub',
  BO:   'Branch Office',
});

// OFFICE_TYPE_SHORT_LABELS — compact label for badges, breadcrumbs.
export const OFFICE_TYPE_SHORT_LABELS = Object.freeze({
  HO:   'HO',
  RO:   'RO',
  LCBO: 'LCBO',
  ZO:   'ZO',
  RCH:  'RCH',
  CCH:  'CCH',
  BO:   'BO',
});

// ----- Display order -----
// Used to sort office lists top-down by hierarchy level (HO first, BO last)
// then alphabetical within a level. Lower number = earlier.
export const OFFICE_TYPE_DISPLAY_ORDER = Object.freeze({
  HO:   1,
  RO:   2,
  LCBO: 3,
  ZO:   4,
  RCH:  5,
  CCH:  6,
  BO:   7,
});

// ----- Singleton constraint -----
// HO is the only type with a one-per-insurer constraint. Validating this
// client-side gives the user a clean error before the DB rejects with
// "duplicate key value violates unique constraint uq_insurer_offices_one_ho_per_insurer".
export const OFFICE_TYPE_IS_SINGLETON = Object.freeze({
  HO:   true,
  RO:   false,
  LCBO: false,
  ZO:   false,
  RCH:  false,
  CCH:  false,
  BO:   false,
});

// ----- Color tokens for type badges -----
// Tailwind-ish hex pairs (background / foreground). Plain CSS objects since
// the portal doesn't use Tailwind. Pick from the existing palette in
// app/insurer-master/page.js so colors stay consistent.
export const OFFICE_TYPE_COLORS = Object.freeze({
  HO:   { bg: '#dbeafe', fg: '#1e40af' }, // blue
  RO:   { bg: '#f3e8ff', fg: '#6b21a8' }, // violet
  LCBO: { bg: '#d1fae5', fg: '#065f46' }, // green
  ZO:   { bg: '#fce7f3', fg: '#9d174d' }, // pink
  RCH:  { bg: '#fef3c7', fg: '#92400e' }, // amber
  CCH:  { bg: '#ffedd5', fg: '#9a3412' }, // orange
  BO:   { bg: '#e2e8f0', fg: '#334155' }, // slate
});

// ----- Hierarchy rules -----
// ALLOWED_PARENT_TYPES[childCode] = array of legal parent codes, or empty
// array for root types. The empty array on HO means "must have parent_office_id
// = NULL" — also encoded in the validator below.
export const ALLOWED_PARENT_TYPES = Object.freeze({
  HO:   Object.freeze([]),                                // root
  RO:   Object.freeze(['HO']),
  LCBO: Object.freeze(['HO']),
  ZO:   Object.freeze(['HO']),
  RCH:  Object.freeze(['RO', 'ZO']),
  CCH:  Object.freeze(['RCH']),
  BO:   Object.freeze(['RO', 'ZO', 'RCH', 'CCH', 'LCBO']),
});

// ALLOWED_CHILD_TYPES is the inverse — for each parent type, which child
// codes are legal. Derived from ALLOWED_PARENT_TYPES so the two views can
// never drift. Used by the parent-office picker UI: "I'm creating a child
// of type X — which existing offices can I pick?"
export const ALLOWED_CHILD_TYPES = Object.freeze(
  OFFICE_CODE_LIST.reduce((acc, parentCode) => {
    acc[parentCode] = Object.freeze(
      OFFICE_CODE_LIST.filter((childCode) =>
        ALLOWED_PARENT_TYPES[childCode].includes(parentCode)
      )
    );
    return acc;
  }, {})
);

// ----- isValidParent(childCode, parentCode) -----
// Returns true iff `parentCode` is a legal parent for `childCode`.
// Special cases:
//   - HO has no legal parent ever — always returns false unless parentCode
//     is null/undefined, which is the "root" case (handled by callers
//     separately, since this function is about non-null parents).
//   - Unknown childCode or parentCode returns false.
//
// Examples:
//   isValidParent('RO',  'HO')   === true
//   isValidParent('CCH', 'RCH')  === true
//   isValidParent('CCH', 'RO')   === false
//   isValidParent('HO',  'HO')   === false  (HO is root)
//   isValidParent('BO',  'BO')   === false  (BO can't parent BO)
//   isValidParent('RO',  null)   === false  (null isn't a valid code)
export function isValidParent(childCode, parentCode) {
  if (typeof childCode !== 'string' || typeof parentCode !== 'string') {
    return false;
  }
  const allowed = ALLOWED_PARENT_TYPES[childCode];
  if (!allowed) return false; // unknown child code
  return allowed.includes(parentCode);
}

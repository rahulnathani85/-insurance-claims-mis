// =============================================================================
// lib/lobSubcategories.js
// =============================================================================
// IRDAI-defined LOB list + sub-category bifurcation.
// Sourced from docs/modifications 30-04-2026.md §4 & §5.
//
// Pure data + lookup helpers — no DB / network dependency.
// Used by:
//   - /claim-registration/[id]      — sub-category dropdown
//   - /communications/review        — LOB picker on intimation tagging
//   - lib/comms/executor             — normalise extracted LOBs
// =============================================================================

// IRDAI LOBs (canonical, used in claims.lob).
export const IRDAI_LOBS = [
  'Fire',
  'Engineering',
  'Marine Cargo',
  'Marine Hull',
  'Motor',
  'Miscellaneous',
  'LOP',
];

// Sub-categories per LOB. The 'Others' entry is the catch-all and is
// always last so the dropdown UX is consistent.
export const LOB_SUBCATEGORIES = {
  Fire: [
    'SFSP (Standard Fire & Special Perils)',
    'Bharat Griha Raksha',
    'Bharat Sookshma Udyam Suraksha',
    'Bharat Laghu Udyam Suraksha',
    'Industrial All Risk (IAR)',
    'Mega Risk',
    'Declaration Policy',
    'Others',
  ],
  'Marine Cargo': [
    'Annual Turnover Policy',
    'Declaration Policy',
    'Sales Turnover Policy',
    'Inland Transit Policy',
    'Open Policy',
    'Specific Voyage Policy',
    'Others',
  ],
  'Marine Hull': [
    'Freight Demurrage Policy',
    'Hull & Machinery Policy',
    'Loss of Hire Policy',
    'P&I Policy',
    'War Risk Policy',
    "Builder's Risk Policy",
    'Inland Vessels Policy',
    'Fishing Vessels Policy',
    'Aviation Policy',
    'Others',
  ],
  Engineering: [
    "CAR (Contractor's All Risk) Policy",
    'EAR (Erection All Risk) Policy',
    "CPM (Contractor's Plant & Machinery) Policy",
    'Machinery Breakdown (MBD) Policy',
    'Boiler & Pressure Plant (BPP) Policy',
    'Electronic Equipment Insurance (EEI) Policy',
    'Civil Engineering Completed Risks (CECR) Policy',
    'Others',
  ],
  Motor: [
    'Private Car Policy',
    'Two-Wheeler Policy',
    'Commercial Vehicle (GCV/PCV) Policy',
    'Miscellaneous & Special Type Vehicles Policy',
    'Others',
  ],
  LOP: [
    'Advance Loss of Profit (ALOP) Policy',
    'Contingent Business Interruption Policy',
    'Machinery Loss of Profit (MLOP) Policy',
    'Standard Business Interruption Policy',
    'Others',
  ],
  Miscellaneous: [
    'All Risk Insurance Policy',
    'Bankers Indemnity Policy',
    'Burglary Policy',
    'Money Insurance Policy',
    'Fidelity Guarantee Policy',
    'Jewellers Block Policy',
    'Plate Glass & Neon Sign Policy',
    'Crop / Livestock Policy',
    "Householder's Package Policy",
    "Shopkeeper's Package Policy",
    'Office Package Policy',
    'Liability — Public Liability Policy',
    'Liability — Product Liability Policy',
    "Liability — Employer's Liability Policy",
    'Liability — Professional Indemnity Policy',
    'Liability — Commercial General Liability (CGL) Policy',
    'Liability — Cyber Liability Policy',
    "Liability — Directors & Officer's (D&O) Policy",
    'Special Contingency — Extended Warranty (Vehicle)',
    'Special Contingency — Extended Warranty (Equipment)',
    'Special Contingency — Extended Warranty (Other)',
    'Others',
  ],
};

// Returns the sub-category list for a given LOB, or [] if LOB is unknown.
export function subcategoriesFor(lob) {
  if (!lob) return [];
  return LOB_SUBCATEGORIES[lob] || [];
}

// Normalises a raw LOB hint (from LLM extraction or legacy data) to one of
// the canonical IRDAI_LOBS values. Falls back to 'Miscellaneous'.
const NORMALIZE = {
  motor: 'Motor', 'motor od': 'Motor', mc: 'Motor', vehicle: 'Motor',
  'marine cargo': 'Marine Cargo', 'marine-cargo': 'Marine Cargo', cargo: 'Marine Cargo',
  'marine hull': 'Marine Hull', 'marine-hull': 'Marine Hull', hull: 'Marine Hull',
  marine: 'Marine Cargo',
  fire: 'Fire',
  engineering: 'Engineering', engg: 'Engineering', engr: 'Engineering',
  miscellaneous: 'Miscellaneous', misc: 'Miscellaneous', general: 'Miscellaneous',
  'business interruption': 'LOP', bi: 'LOP', lop: 'LOP', mlop: 'LOP',
  liability: 'Miscellaneous',
};

export function normaliseLob(raw) {
  if (!raw) return 'Miscellaneous';
  const key = String(raw).trim().toLowerCase();
  return NORMALIZE[key] || (IRDAI_LOBS.includes(raw) ? raw : 'Miscellaneous');
}

// Heuristic: given the LLM extraction blob, suggest a sub-category for the
// given LOB. Returns null when no good match.
//
// The extraction pipeline doesn't yet emit a structured sub-category, so
// we fall back to fuzzy substring match against `policy_type` text.
export function suggestSubcategory(lob, extractedData = {}) {
  if (!lob) return null;
  const subs = subcategoriesFor(lob);
  if (subs.length === 0) return null;

  const haystack = [
    extractedData.policy_type,
    extractedData.policy_subtype,
    extractedData.lob_subcategory,
    extractedData.coverage_type,
  ].filter(Boolean).map((s) => String(s).toLowerCase()).join(' | ');

  if (!haystack) return null;

  // First exact-ish match wins.
  for (const sub of subs) {
    if (sub === 'Others') continue;
    const tokens = sub
      .toLowerCase()
      .replace(/[()]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 4);
    if (tokens.length === 0) continue;
    const hits = tokens.filter((t) => haystack.includes(t)).length;
    if (hits >= Math.min(2, tokens.length)) return sub;
  }
  return null;
}

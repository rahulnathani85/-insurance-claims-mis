// =============================================================================
// lib/officeRoles.js
// =============================================================================
// The 3 insurer-office roles on a claim, with their display labels and
// color cues (matching the existing EW pages so the new picker doesn't
// look out of place). Extracted from components/ThreeOfficePicker.js so
// vitest (no JSX loader for .js) can import the pure config.
// =============================================================================

export const ROLE_DEFS = [
  { role: 'appointing', label: 'Appointing Office',                          color: '#92400e' /* amber */ },
  { role: 'policy',     label: 'Underwriting / Policy Issuing Office',       color: '#1e40af' /* blue  */ },
  { role: 'fsr',        label: 'Report Submission Office',                   color: '#166534' /* green */ },
];

// buildRoleConfig — pure helper. Returns the per-role config a render pass
// should use, with `required: true` for any role NOT in `optionalRoles`.
//
// Default: ['fsr'] — Report Submission Office is often only known later
// in the lifecycle; keeping it optional avoids blocking initial registration.
export function buildRoleConfig(optionalRoles = ['fsr']) {
  const optionalSet = new Set(optionalRoles);
  return ROLE_DEFS.map((def) => ({
    ...def,
    required: !optionalSet.has(def.role),
  }));
}

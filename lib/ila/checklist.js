// =============================================================================
// lib/ila/checklist.js
// =============================================================================
// Default document checklist per LOB. Used to seed an ILA draft's
// `documents_required` array on creation. The clerk can add/remove items
// during drafting.
//
// Source: docs/ila-module-spec.md §5 (peril metadata) + IRDAI common-practice
// document expectations per LOB. Phase 2 will move this to a `peril_metadata`
// DB table so admins can edit without deployment; for Phase 1 we keep it
// here as a single source of truth that the API and tests both consume.
// =============================================================================

// Each item: { type, reason, priority }
//   type     — short name shown in the UI (FIR, Policy schedule, Estimate)
//   reason   — why we need it (ties to admissibility / quantum)
//   priority — 'high' | 'medium' | 'low' (sort order in the UI)

const FIRE_DEFAULTS = [
  { type: 'Policy schedule with endorsements', reason: 'Coverage scope + sum insured', priority: 'high' },
  { type: 'FIR / fire-brigade report', reason: 'Cause of loss and scene record', priority: 'high' },
  { type: 'Stock statement (last submitted)', reason: 'Pre-loss inventory', priority: 'high' },
  { type: 'Damage estimate from insured', reason: 'Insured-stated quantum', priority: 'high' },
  { type: 'Photographs of damaged stock / building', reason: 'Visual evidence', priority: 'high' },
  { type: 'Repair / replacement quotations', reason: 'Quantum verification', priority: 'medium' },
  { type: 'Books of accounts (last 3 months)', reason: 'Financial verification', priority: 'medium' },
  { type: 'Salvage details / disposal plan', reason: 'Net loss computation', priority: 'medium' },
];

const ENGINEERING_DEFAULTS = [
  { type: 'Policy schedule with endorsements', reason: 'Coverage scope + sum insured', priority: 'high' },
  { type: 'Project / contract documents', reason: 'Insured interest, scope of work', priority: 'high' },
  { type: 'Incident / breakdown report', reason: 'Cause and sequence of failure', priority: 'high' },
  { type: 'Maintenance / service records', reason: 'Wear-and-tear vs covered peril', priority: 'high' },
  { type: 'Operator statement', reason: 'First-hand account of incident', priority: 'medium' },
  { type: 'Repair quotations from OEM / third party', reason: 'Quantum', priority: 'high' },
  { type: 'Photographs of damaged equipment', reason: 'Visual evidence', priority: 'high' },
  { type: 'Original purchase invoice', reason: 'Insured value reconciliation', priority: 'medium' },
];

const MARINE_CARGO_DEFAULTS = [
  { type: 'Policy / certificate of insurance', reason: 'Coverage scope', priority: 'high' },
  { type: 'Bill of lading / airway bill', reason: 'Carrier evidence', priority: 'high' },
  { type: 'Commercial invoice + packing list', reason: 'Insured value + contents', priority: 'high' },
  { type: 'Survey report (preliminary)', reason: 'Damage extent', priority: 'high' },
  { type: 'Carrier protest / claim notice on carrier', reason: 'Subrogation rights', priority: 'high' },
  { type: 'Photographs of damaged consignment + packaging', reason: 'Visual evidence', priority: 'high' },
  { type: 'Customs / port records', reason: 'Transit verification', priority: 'medium' },
  { type: 'Survey report at destination', reason: 'Final assessment', priority: 'medium' },
];

const MARINE_HULL_DEFAULTS = [
  { type: 'Policy / certificate', reason: 'Coverage scope', priority: 'high' },
  { type: "Master's report / log book extracts", reason: 'Cause and sequence', priority: 'high' },
  { type: 'Class society reports', reason: 'Vessel condition', priority: 'high' },
  { type: 'Damage / repair specs', reason: 'Quantum', priority: 'high' },
  { type: 'Salvage / general average documents', reason: 'Apportionment', priority: 'medium' },
  { type: 'Photographs of damage', reason: 'Visual evidence', priority: 'high' },
];

const MOTOR_DEFAULTS = [
  { type: 'Policy schedule', reason: 'Coverage scope', priority: 'high' },
  { type: 'RC + driving licence', reason: 'Insured interest + driver eligibility', priority: 'high' },
  { type: 'FIR (theft / third-party)', reason: 'Police record', priority: 'high' },
  { type: 'Repair estimate from authorised workshop', reason: 'Quantum', priority: 'high' },
  { type: 'Photographs of damaged vehicle', reason: 'Visual evidence', priority: 'high' },
  { type: 'Pre-loss vehicle photos (if available)', reason: 'Pre-existing damage exclusions', priority: 'medium' },
  { type: 'Witness statements', reason: 'Cause verification', priority: 'low' },
];

const LOP_DEFAULTS = [
  { type: 'Policy schedule (BI / LOP)', reason: 'Indemnity period + sum insured', priority: 'high' },
  { type: 'Audited financial statements (last 3 yrs)', reason: 'Standard turnover baseline', priority: 'high' },
  { type: 'Monthly revenue + cost data', reason: 'Loss-period quantification', priority: 'high' },
  { type: 'Material-damage claim file (cross-reference)', reason: 'Trigger event', priority: 'high' },
  { type: 'Production / sales records', reason: 'Indemnity-period quantification', priority: 'medium' },
  { type: 'Mitigation efforts evidence', reason: 'Reasonable steps to minimise loss', priority: 'medium' },
];

const MISC_DEFAULTS = [
  { type: 'Policy schedule with endorsements', reason: 'Coverage scope', priority: 'high' },
  { type: 'Incident report', reason: 'Cause of loss', priority: 'high' },
  { type: 'Damage / loss estimate', reason: 'Quantum', priority: 'high' },
  { type: 'Photographs / supporting evidence', reason: 'Visual evidence', priority: 'high' },
  { type: 'FIR (theft / fidelity / liability)', reason: 'Police record where applicable', priority: 'medium' },
];

const CHECKLIST_BY_LOB = {
  Fire: FIRE_DEFAULTS,
  Engineering: ENGINEERING_DEFAULTS,
  'Marine Cargo': MARINE_CARGO_DEFAULTS,
  'Marine Hull': MARINE_HULL_DEFAULTS,
  Motor: MOTOR_DEFAULTS,
  Miscellaneous: MISC_DEFAULTS,
  LOP: LOP_DEFAULTS,
};

// Returns the default checklist for a given LOB, or the Miscellaneous fallback.
// Each item is cloned (no shared array references between drafts).
export function defaultChecklistFor(lob) {
  const list = CHECKLIST_BY_LOB[lob] || MISC_DEFAULTS;
  return list.map((item) => ({
    ...item,
    status: 'pending', // 'pending' | 'received' | 'waived'
  }));
}

export const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

export function sortChecklist(items) {
  return [...(items || [])].sort((a, b) => {
    const ap = PRIORITY_ORDER[a.priority] ?? 99;
    const bp = PRIORITY_ORDER[b.priority] ?? 99;
    if (ap !== bp) return ap - bp;
    return (a.type || '').localeCompare(b.type || '');
  });
}

export { CHECKLIST_BY_LOB };

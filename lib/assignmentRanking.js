// =============================================================================
// lib/assignmentRanking.js
// =============================================================================
// Pure ranking + conflict-check helpers for surveyor assignment (registration
// spec §7, §10).
//
// Inputs are plain objects so this module is fully unit-testable without any
// Supabase dependency. The /api/claims/[id]/suggested-surveyors route does the
// DB joins and feeds the result here.
//
// Ranking signal (spec §7):
//   1. license valid + peril licensed → must-have (otherwise filtered out)
//   2. lower active workload → preferred
//   3. region match with claim's loss location → preferred
//   4. conflict declared against insurer/insured/broker → must-have NOT
//      (otherwise filtered out unless caller passes allowConflicted)
//
// Score is a small composite: the absolute number is meaningless, the order
// is what matters.
// =============================================================================

import { isEligibleForAssignment } from './surveyors.js';

export const ASSIGNMENT_ROLES = [
  'lead_surveyor',
  'co_surveyor',
  'engineer',
  'ca',
  'manager',
  'observer',
];

// Default top-N to surface in the registration form right pane.
export const SUGGESTION_TOP_N = 5;

// Scoring weights — tweakable; tests pin the relative ordering, not magnitudes.
const WEIGHTS = {
  PERIL_MATCH:     50,
  REGION_MATCH:    30,
  WORKLOAD_PENALTY: 2,   // multiplied by active claim count
  EXPIRY_BUFFER:    1,   // 1 point per day past the 30-day buffer (capped)
};

const MAX_EXPIRY_BONUS = 60;

// Returns { eligible: [...], blocked: [...] } — both sorted, ranked, and
// shaped for UI consumption.
//
// inputs:
//   claim:      { lob, peril_type?, insurer_name, insured_name, broker_name?,
//                 loss_location_state? }
//   surveyors:  array from /api/surveyors (already includes license_status)
//   conflicts:  array from surveyor_conflicts (whole table or filtered)
//   workloads:  optional map { surveyor_id: count_of_active_claims }
//   today:      Date for license-status calc (injectable for tests)
//   options:    { allowConflicted?: boolean }
//
// returns:
//   {
//     eligible: [{ surveyor, score, reasons, conflicts }],
//     blocked:  [{ surveyor, reason }],
//   }
export function rankSurveyors({
  claim,
  surveyors = [],
  conflicts = [],
  workloads = {},
  today = new Date(),
  options = {},
} = {}) {
  const allowConflicted = options.allowConflicted === true;

  const claimPeril = (claim?.peril_type || claim?.lob || '').trim();
  const claimRegion = (claim?.loss_location_state || claim?.region || '').trim();
  const claimNames = {
    insurer: (claim?.insurer_name || '').trim().toLowerCase(),
    insured: (claim?.insured_name || '').trim().toLowerCase(),
    broker:  (claim?.broker_name  || '').trim().toLowerCase(),
  };

  // Index conflicts by surveyor_id for O(1) lookup.
  const conflictsBySurveyor = new Map();
  for (const c of conflicts || []) {
    if (!c?.surveyor_id) continue;
    const arr = conflictsBySurveyor.get(c.surveyor_id) || [];
    arr.push(c);
    conflictsBySurveyor.set(c.surveyor_id, arr);
  }

  const eligible = [];
  const blocked = [];

  for (const s of surveyors || []) {
    // 1. License gate.
    const elig = isEligibleForAssignment(s, today);
    if (!elig.eligible) {
      blocked.push({ surveyor: s, reason: elig.reason });
      continue;
    }

    // 2. Peril gate (warning, not block — clerk can override, the gate is at
    //    the app level: spec §7 says "filter by peril licensed").
    //    If the surveyor has explicit peril_specialties, they must include the
    //    claim's peril; if peril_specialties is empty/null, treat as generalist.
    const perilSpecialties = Array.isArray(s.peril_specialties) ? s.peril_specialties : [];
    const perilMatch = perilSpecialties.length === 0
      ? null   // generalist — neither bonus nor block
      : perilSpecialties.some(p => sameText(p, claimPeril));

    if (perilSpecialties.length > 0 && !perilMatch) {
      blocked.push({ surveyor: s, reason: `Not licensed for ${claimPeril}` });
      continue;
    }

    // 3. Conflict check (spec §7).
    const surveyorConflicts = (conflictsBySurveyor.get(s.id) || []).filter(c => {
      const v = (c.conflict_value || '').trim().toLowerCase();
      if (!v) return false;
      if (c.conflict_type === 'insurer' && v && claimNames.insurer && (v === claimNames.insurer || claimNames.insurer.includes(v))) return true;
      if (c.conflict_type === 'insured' && v && claimNames.insured && (v === claimNames.insured || claimNames.insured.includes(v))) return true;
      if (c.conflict_type === 'broker'  && v && claimNames.broker  && (v === claimNames.broker  || claimNames.broker.includes(v))) return true;
      return false;
    });

    if (surveyorConflicts.length > 0 && !allowConflicted) {
      blocked.push({
        surveyor: s,
        reason: `Conflict declared: ${surveyorConflicts.map(c => `${c.conflict_type}=${c.conflict_value}`).join(', ')}`,
      });
      continue;
    }

    // 4. Score.
    const reasons = [];
    let score = 0;

    if (perilMatch === true) {
      score += WEIGHTS.PERIL_MATCH;
      reasons.push(`Licensed for ${claimPeril}`);
    } else if (perilMatch === null) {
      reasons.push('Generalist (no peril restriction recorded)');
    }

    if (claimRegion && s.region && sameText(s.region, claimRegion)) {
      score += WEIGHTS.REGION_MATCH;
      reasons.push(`Region match: ${s.region}`);
    }

    const workload = Number(workloads[s.id] || 0);
    if (workload > 0) {
      score -= workload * WEIGHTS.WORKLOAD_PENALTY;
      reasons.push(`${workload} active claim${workload === 1 ? '' : 's'}`);
    } else {
      reasons.push('No active claims');
    }

    if (s.license_expiry_date) {
      const days = daysFromToday(s.license_expiry_date, today);
      const buffer = Math.max(0, days - 30);
      const bonus = Math.min(MAX_EXPIRY_BONUS, buffer * WEIGHTS.EXPIRY_BUFFER);
      score += bonus;
    }

    eligible.push({
      surveyor: s,
      score,
      reasons,
      conflicts: surveyorConflicts,
    });
  }

  eligible.sort((a, b) => b.score - a.score);

  return { eligible, blocked };
}

// Returns the surveyor IDs whose conflicts match the claim. Pure helper for
// the explicit conflict-check API.
export function findConflictedSurveyors({ claim, conflicts }) {
  const claimNames = {
    insurer: (claim?.insurer_name || '').trim().toLowerCase(),
    insured: (claim?.insured_name || '').trim().toLowerCase(),
    broker:  (claim?.broker_name  || '').trim().toLowerCase(),
  };
  const out = [];
  for (const c of conflicts || []) {
    if (!c?.surveyor_id || !c?.conflict_value) continue;
    const v = c.conflict_value.trim().toLowerCase();
    const claimVal = claimNames[c.conflict_type];
    if (!claimVal) continue;
    if (claimVal === v || claimVal.includes(v)) {
      out.push({ surveyor_id: c.surveyor_id, conflict: c });
    }
  }
  return out;
}

function sameText(a, b) {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

function daysFromToday(date, today) {
  const d = date instanceof Date ? date : new Date(date);
  const t = today instanceof Date ? today : new Date(today);
  if (Number.isNaN(d.getTime()) || Number.isNaN(t.getTime())) return 0;
  const dUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const tUtc = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  return Math.floor((dUtc - tUtc) / 86_400_000);
}

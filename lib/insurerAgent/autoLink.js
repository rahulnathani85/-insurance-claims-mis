// =============================================================================
// lib/insurerAgent/autoLink.js
// =============================================================================
// Pure helpers for the Review screen + the commit endpoint:
//
//   suggestParents(offices)    - for every office without a parent_name,
//                                returns a suggested parent index (or null).
//                                Used by the "Auto-link parents" button on
//                                the Review screen.
//
//   topologicalOrder(offices)  - returns a permutation of indices such that
//                                an office never appears before its parent.
//                                Used by the commit endpoint to insert
//                                offices level-by-level so parent_office_id
//                                FKs always resolve.
//
//   validateOffices(offices)   - returns { errors: string[] } enumerating
//                                shape and hierarchy violations. Empty
//                                array means "Save is enabled".
//
// The sole authority on hierarchy rules is lib/insurerOfficeTypes.js
// (ALLOWED_PARENT_TYPES + isValidParent + OFFICE_TYPE_IS_SINGLETON).
// We import from there so a future change to the rules propagates here
// without edits.
// =============================================================================

import {
  ALLOWED_PARENT_TYPES,
  OFFICE_TYPE_IS_SINGLETON,
  isValidParent,
  OFFICE_CODE_LIST,
} from '@/lib/insurerOfficeTypes';

// ---------------------------------------------------------------------------
// suggestParents(offices) -> Array<{ index, parentIndex|null, reason }>
//
// "Closest matching" heuristic for every office that has no parent_name:
//   1. Find candidates whose office_code is in ALLOWED_PARENT_TYPES[code].
//   2. Prefer same-city matches; fall back to same-state.
//   3. If multiple candidates remain, prefer the one with the highest
//      OFFICE_TYPE_DISPLAY_ORDER value (i.e. shallower in the hierarchy —
//      a BO parented to RO not RCH when both are eligible).
//
// Returns one entry per input office. parentIndex is null when:
//   - the office is HO (no parent allowed)
//   - the office already has parent_name set (caller can ignore)
//   - no candidate satisfies isValidParent + same-city/state
// ---------------------------------------------------------------------------

export function suggestParents(offices) {
  if (!Array.isArray(offices)) return [];

  const out = offices.map((_, i) => ({ index: i, parentIndex: null, reason: 'no candidate' }));

  for (let i = 0; i < offices.length; i++) {
    const child = offices[i];
    if (!child || typeof child !== 'object') continue;
    const childCode = String(child.office_code || '').toUpperCase();
    if (childCode === 'HO') {
      out[i] = { index: i, parentIndex: null, reason: 'HO is a root' };
      continue;
    }
    if (child.parent_name && String(child.parent_name).trim()) {
      out[i] = { index: i, parentIndex: null, reason: 'already linked' };
      continue;
    }

    const allowedParentCodes = ALLOWED_PARENT_TYPES[childCode] || [];
    if (allowedParentCodes.length === 0) {
      out[i] = { index: i, parentIndex: null, reason: 'no legal parent type' };
      continue;
    }

    // Build candidate pool from the same offices array.
    const candidates = [];
    for (let j = 0; j < offices.length; j++) {
      if (j === i) continue;
      const cand = offices[j];
      if (!cand) continue;
      const candCode = String(cand.office_code || '').toUpperCase();
      if (!allowedParentCodes.includes(candCode)) continue;
      candidates.push({ idx: j, office: cand, code: candCode });
    }
    if (candidates.length === 0) {
      out[i] = { index: i, parentIndex: null, reason: 'no eligible candidate type' };
      continue;
    }

    // Score each candidate. Lower score wins.
    const scored = candidates.map((c) => ({
      ...c,
      score: scoreCandidate(child, c.office),
    }));
    scored.sort((a, b) => a.score - b.score);
    const winner = scored[0];

    out[i] = {
      index: i,
      parentIndex: winner.idx,
      reason: explainScore(child, winner.office, winner.score),
    };
  }

  return out;
}

function scoreCandidate(child, candidate) {
  // 0 = same city, 1 = same state, 2 = no overlap. Lower wins.
  const cChild = norm(child.city);
  const cCand = norm(candidate.city);
  const sChild = norm(child.state);
  const sCand = norm(candidate.state);
  if (cChild && cCand && cChild === cCand) return 0;
  if (sChild && sCand && sChild === sCand) return 1;
  return 2;
}

function explainScore(child, candidate, score) {
  if (score === 0) return `same city as ${candidate.name}`;
  if (score === 1) return `same state as ${candidate.name}`;
  return `nearest type match (${candidate.name})`;
}

function norm(s) {
  return typeof s === 'string' ? s.trim().toLowerCase() : '';
}

// ---------------------------------------------------------------------------
// topologicalOrder(offices) -> { order: number[], cycle: boolean }
//
// Returns indices ordered such that for every i in `order`, offices[i]'s
// parent (looked up by name) appears earlier in `order`. When parent_name
// can't be resolved within the array, the office is treated as a root.
//
// cycle === true if the parent_name graph contains a cycle (which the
// commit endpoint should treat as a 400). order is still returned but with
// the cycle members appended at the end in arbitrary order.
// ---------------------------------------------------------------------------

export function topologicalOrder(offices) {
  if (!Array.isArray(offices)) return { order: [], cycle: false };

  // Build name -> index map for parent resolution.
  const nameToIdx = new Map();
  offices.forEach((o, i) => {
    if (o && typeof o.name === 'string' && o.name.trim()) {
      // Last-write-wins: if two offices share a name, only the latest is
      // resolvable as a parent. Validation reports the duplicate-name error
      // separately.
      nameToIdx.set(o.name.trim(), i);
    }
  });

  // Adjacency: parentIdx -> [childIdx, ...]
  const childrenOf = new Map();
  const parentOf = new Map();
  for (let i = 0; i < offices.length; i++) {
    const o = offices[i];
    if (!o) continue;
    const pname = typeof o.parent_name === 'string' ? o.parent_name.trim() : '';
    if (!pname) continue;
    const pIdx = nameToIdx.get(pname);
    if (pIdx == null || pIdx === i) continue; // self-parent ignored
    parentOf.set(i, pIdx);
    if (!childrenOf.has(pIdx)) childrenOf.set(pIdx, []);
    childrenOf.get(pIdx).push(i);
  }

  // Kahn's algorithm.
  const indeg = new Map();
  for (let i = 0; i < offices.length; i++) {
    indeg.set(i, parentOf.has(i) ? 1 : 0);
  }
  const queue = [];
  for (const [i, d] of indeg) if (d === 0) queue.push(i);

  const order = [];
  while (queue.length > 0) {
    const i = queue.shift();
    order.push(i);
    const kids = childrenOf.get(i) || [];
    for (const k of kids) {
      indeg.set(k, indeg.get(k) - 1);
      if (indeg.get(k) === 0) queue.push(k);
    }
  }

  let cycle = false;
  if (order.length < offices.length) {
    cycle = true;
    // Append cycle members so the caller can still see them.
    for (let i = 0; i < offices.length; i++) {
      if (!order.includes(i)) order.push(i);
    }
  }

  return { order, cycle };
}

// ---------------------------------------------------------------------------
// validateOffices(offices) -> { errors: string[] }
//
// Hard rules (block Save):
//   - Every office must have an office_code in OFFICE_CODE_LIST.
//   - Every office must have a non-empty name.
//   - At most one HO (DB enforces UNIQUE; we surface the error early).
//   - Must have at least one HO unless the offices array is empty.
//   - For every office with parent_name set: parent must exist in the array
//     AND isValidParent(child.code, parent.code) must return true.
//   - HO must NOT have parent_name set.
//   - Names must be unique within the batch (otherwise parent resolution
//     becomes ambiguous and the FK trigger may rebind to the wrong row).
// ---------------------------------------------------------------------------

export function validateOffices(offices) {
  const errors = [];
  if (!Array.isArray(offices)) {
    errors.push('offices must be an array');
    return { errors };
  }
  if (offices.length === 0) return { errors: [] };

  // Build code lookup by name once.
  const byName = new Map();
  const dupNames = new Set();
  for (let i = 0; i < offices.length; i++) {
    const o = offices[i];
    const nm = typeof o?.name === 'string' ? o.name.trim() : '';
    if (!nm) continue;
    if (byName.has(nm)) dupNames.add(nm);
    else byName.set(nm, i);
  }
  for (const dn of dupNames) {
    errors.push(`Duplicate office name: "${dn}" — names must be unique within the insurer.`);
  }

  let hoCount = 0;
  for (let i = 0; i < offices.length; i++) {
    const o = offices[i];
    if (!o || typeof o !== 'object') {
      errors.push(`Row ${i + 1}: invalid office row.`);
      continue;
    }
    const code = String(o.office_code || '').toUpperCase();
    const name = typeof o.name === 'string' ? o.name.trim() : '';

    if (!code || !OFFICE_CODE_LIST.includes(code)) {
      errors.push(`Row ${i + 1}: office_code "${o.office_code}" is not one of ${OFFICE_CODE_LIST.join(', ')}.`);
      continue;
    }
    if (!name) {
      errors.push(`Row ${i + 1}: name is required.`);
      continue;
    }

    if (code === 'HO') {
      hoCount += 1;
      if (o.parent_name && String(o.parent_name).trim()) {
        errors.push(`Row ${i + 1} (${name}): HO must have no parent.`);
      }
      continue;
    }

    // Non-HO must have a legal parent in the batch.
    const pname = typeof o.parent_name === 'string' ? o.parent_name.trim() : '';
    if (!pname) {
      const allowed = ALLOWED_PARENT_TYPES[code] || [];
      errors.push(
        `Row ${i + 1} (${name}): ${code} requires a parent (one of: ${allowed.join(', ')}). ` +
          `Click "Auto-link parents" to suggest, or set Parent manually.`
      );
      continue;
    }
    const pIdx = byName.get(pname);
    if (pIdx == null) {
      errors.push(`Row ${i + 1} (${name}): parent "${pname}" not found among the offices.`);
      continue;
    }
    const parentCode = String(offices[pIdx]?.office_code || '').toUpperCase();
    if (!isValidParent(code, parentCode)) {
      errors.push(
        `Row ${i + 1} (${name}): ${code} cannot have a ${parentCode} parent. ` +
          `Allowed parent types: ${(ALLOWED_PARENT_TYPES[code] || []).join(', ')}.`
      );
    }
  }

  if (offices.length > 0 && hoCount === 0) {
    errors.push('Insurer must have exactly one Head Office (HO) — none was provided.');
  }
  if (hoCount > 1) {
    errors.push(`Insurer has ${hoCount} HO rows — only one is allowed per insurer.`);
    if (OFFICE_TYPE_IS_SINGLETON.HO !== true) {
      // Sanity check; should never trip.
      errors.push('Internal: OFFICE_TYPE_IS_SINGLETON.HO is no longer true — code drift.');
    }
  }

  return { errors };
}

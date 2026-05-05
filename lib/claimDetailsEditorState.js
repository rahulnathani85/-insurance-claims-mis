// =============================================================================
// lib/claimDetailsEditorState.js
// =============================================================================
// Pure state-management helpers for components/ClaimDetailsEditor.jsx.
// Lives in lib/ (no JSX) so vitest can unit-test them without pulling React
// transitively through the component module — same pattern we use for the
// office-picker state and the array-field editor.
// =============================================================================

import {
  LOCKED_REGISTRATION_FIELDS,
  allEditableFieldKeys,
} from './claimRegistrationSections.js';

// initFormState — pull every editable column off the claim row + add the
// transient _insurer_id (used to scope ThreeOfficePicker; not persisted —
// the claims table has no insurer_id column today).
export function initFormState(claim) {
  if (!claim || typeof claim !== 'object') return {};
  const out = { _insurer_id: null };
  for (const key of allEditableFieldKeys()) {
    if (Object.prototype.hasOwnProperty.call(claim, key)) {
      out[key] = claim[key];
    }
  }
  return out;
}

// buildPutBody — diff against last-saved snapshot, return only changed
// editable keys. Strips locked + transient flags. The dual-write +
// EW sync on the server only fires for fields that show up in the body,
// so this keeps the audit log tight.
export function buildPutBody(current, lastSaved) {
  const body = {};
  for (const key of allEditableFieldKeys()) {
    if (LOCKED_REGISTRATION_FIELDS.includes(key)) continue;
    if (key.startsWith('_')) continue;
    const a = current?.[key];
    const b = lastSaved?.[key];
    if (!sameValue(a, b)) body[key] = a;
  }
  return body;
}

// sameValue — loose equality used by the diff. Treats matching numeric
// strings ("1250000000" vs 1250000000) as equal so re-keying a number
// input doesn't generate a spurious PUT.
function sameValue(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    const an = Number(a), bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an === bn;
  }
  return String(a) === String(b);
}

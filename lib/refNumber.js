// =============================================================================
// lib/refNumber.js
// =============================================================================
// Helpers for the claim ref_number lifecycle.
//
// Pre-registration claims carry a stop-gap "INTAKE/<company>/<short_msg_id>"
// ref. The portal treats anything starting with "INTAKE/" as a placeholder
// that must be replaced with a real surveyor reference before the claim can
// be registered. After registration, ref_number is immutable.
// =============================================================================

export const PLACEHOLDER_PREFIX = 'INTAKE/';

export function isPlaceholderRef(value) {
  return typeof value === 'string' && value.startsWith(PLACEHOLDER_PREFIX);
}

// Returns the 8-char short message id from an INTAKE/<co>/<short> ref, or
// null if the input isn't a placeholder. Useful for cross-referencing back
// to the originating inbox_messages.id.
export function extractIntakeShortId(value) {
  if (!isPlaceholderRef(value)) return null;
  const parts = value.split('/');
  if (parts.length < 3) return null;
  return parts[2] || null;
}

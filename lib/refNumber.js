// =============================================================================
// lib/refNumber.js
// =============================================================================
// Helpers for the claim ref_number lifecycle.
//
// Pre-registration claims carry a stop-gap placeholder ref that must be
// replaced with a real surveyor reference before the claim can be registered.
// Two placeholder shapes today:
//   INTAKE/<company>/<8-char-msg-id>  — claims auto-created from the comms
//                                       pipeline (lib/comms/executor.js
//                                       actionCreateClaim)
//   MANUAL/<company>/<8-char-uuid>    — claims created manually via the
//                                       /communications/intimations New
//                                       Manual Claim button (POST
//                                       /api/claims/manual)
//
// After registration, ref_number is immutable.
// =============================================================================

// PLACEHOLDER_PREFIX is the legacy single-prefix export, kept for
// backward compatibility with any caller that grabbed it directly.
// PLACEHOLDER_PREFIXES is the canonical list — use this for new code.
export const PLACEHOLDER_PREFIX = 'INTAKE/';
export const PLACEHOLDER_PREFIXES = ['INTAKE/', 'MANUAL/'];

export function isPlaceholderRef(value) {
  if (typeof value !== 'string') return false;
  return PLACEHOLDER_PREFIXES.some((prefix) => value.startsWith(prefix));
}

// Returns the 8-char short id from an INTAKE/<co>/<short> ref, or null
// if the input isn't an INTAKE-prefix placeholder. Useful for cross-
// referencing back to the originating inbox_messages.id. Manual placeholders
// have no source-message back-link, so this helper specifically targets
// the INTAKE shape.
export function extractIntakeShortId(value) {
  if (typeof value !== 'string' || !value.startsWith(PLACEHOLDER_PREFIX)) {
    return null;
  }
  const parts = value.split('/');
  if (parts.length < 3) return null;
  return parts[2] || null;
}

// =============================================================================
// lib/claimDocuments.js
// =============================================================================
// Pure helpers for the unified Documents tab. Currently exposes filename
// sanitisation used by the rename endpoint; kept testable without any
// Supabase dependency.
// =============================================================================

export const MAX_FILE_NAME_LENGTH = 255;

// Path separators + Windows-reserved chars. These have no semantic place
// in a display filename so we strip them entirely rather than space-substitute.
const STRIP_RE = /[/\\<>:"|?*]/g;

// Control chars (0x00–0x1F) are converted to spaces (NOT stripped) so that
// `foo\tbar` becomes `foo bar`, not `foobar`.
const CONTROL_TO_SPACE_RE = /[\x00-\x1f]/g;

// Trim, normalise control chars to spaces, strip path/reserved chars,
// collapse whitespace, cap length. Returns null when the result is empty
// after sanitisation.
export function sanitiseDisplayName(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw);
  s = s.replace(CONTROL_TO_SPACE_RE, ' ');
  s = s.replace(STRIP_RE, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length === 0) return null;
  if (s.length > MAX_FILE_NAME_LENGTH) {
    // Preserve extension if present, truncate the stem.
    const lastDot = s.lastIndexOf('.');
    if (lastDot > 0 && lastDot > s.length - 12) {
      const ext = s.slice(lastDot);
      const stem = s.slice(0, lastDot).slice(0, MAX_FILE_NAME_LENGTH - ext.length);
      s = stem + ext;
    } else {
      s = s.slice(0, MAX_FILE_NAME_LENGTH);
    }
  }
  return s;
}

// =============================================================================
// lib/fsr/arrayFieldEditor.js
// =============================================================================
// Pure-logic helpers for the 'array' field type rendered by
// components/fsr/NarrativeEditor.jsx. Factored out here so they can be
// unit-tested without rendering the React tree, and so a future automation
// (e.g. AI-populated damaged_items) can call them with the same contract.
//
// All helpers are NON-MUTATING — they return a fresh array. Callers should
// use the result for setState; the input is left untouched.
// =============================================================================

// emptyRowFor(itemSchema) — returns a new row with all keys defaulted to ''
// (empty string). Numbers are not pre-coerced to 0 so the input shows blank
// rather than '0' on first render.
export function emptyRowFor(itemSchema) {
  if (!Array.isArray(itemSchema)) return {};
  const row = {};
  for (const col of itemSchema) {
    if (col && typeof col.key === 'string') row[col.key] = '';
  }
  return row;
}

// applyArrayRowChange(rows, index, columnKey, value) — returns a new rows
// array with the row at `index` having `columnKey` set to `value`.
// Out-of-bounds index is a no-op (returns rows unchanged); a real fix is
// the caller's responsibility, not the helper's.
export function applyArrayRowChange(rows, index, columnKey, value) {
  if (!Array.isArray(rows)) return rows;
  if (typeof columnKey !== 'string' || columnKey.length === 0) return rows;
  if (typeof index !== 'number' || index < 0 || index >= rows.length) return rows;
  const next = rows.slice();
  next[index] = { ...(rows[index] || {}), [columnKey]: value };
  return next;
}

// insertArrayRow(rows, itemSchema, index?) — returns a new rows array with
// an empty row inserted at `index`. If `index` is undefined or out of
// range, the row is appended at the end.
export function insertArrayRow(rows, itemSchema, index) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const newRow = emptyRowFor(itemSchema);
  const at = (typeof index === 'number' && index >= 0 && index <= list.length) ? index : list.length;
  list.splice(at, 0, newRow);
  return list;
}

// deleteArrayRow(rows, index) — returns a new rows array with the row at
// `index` removed. Out-of-bounds index is a no-op.
export function deleteArrayRow(rows, index) {
  if (!Array.isArray(rows)) return rows;
  if (typeof index !== 'number' || index < 0 || index >= rows.length) return rows;
  const next = rows.slice();
  next.splice(index, 1);
  return next;
}

// coerceArrayRows(rows, itemSchema) — light normaliser used when the parent
// loads narrative_jsonb from the DB. Ensures every row is an object and has
// every column key defined (missing keys default to ''). Doesn't drop extra
// keys — callers may extend the schema and we want old values preserved.
export function coerceArrayRows(rows, itemSchema) {
  if (!Array.isArray(rows)) return [];
  if (!Array.isArray(itemSchema)) return rows;
  return rows.map((r) => {
    if (!r || typeof r !== 'object') return emptyRowFor(itemSchema);
    const merged = { ...r };
    for (const col of itemSchema) {
      if (col && typeof col.key === 'string' && !(col.key in merged)) {
        merged[col.key] = '';
      }
    }
    return merged;
  });
}

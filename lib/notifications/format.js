// =============================================================================
// lib/notifications/format.js
// =============================================================================
// Formatting helpers shared by notification templates.
// =============================================================================

export function fmtDateTimeIST(value) {
  if (!value) return 'TBD';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return 'TBD';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }) + ' IST';
}

export function fmtINR(value) {
  if (value === null || value === undefined || value === '') return 'N/A';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'N/A';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

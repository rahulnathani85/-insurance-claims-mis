// =============================================================================
// lib/ila/index.js
// =============================================================================
// Shared helpers for the ILA module.
// =============================================================================

export { defaultChecklistFor, sortChecklist, PRIORITY_ORDER, CHECKLIST_BY_LOB } from './checklist.js';
export { renderIlaHtml } from './templates.js';

export const ADMISSIBILITY_OPTIONS = [
  { value: 'admissible', label: 'Admissible (prima facie covered)' },
  { value: 'admissible_with_conditions', label: 'Admissible with conditions' },
  { value: 'needs_investigation', label: 'Needs investigation' },
  { value: 'likely_non_admissible', label: 'Likely non-admissible' },
  { value: 'non_admissible', label: 'Non-admissible' },
];

export const DRAFT_STATUSES = ['draft', 'under_review', 'approved', 'rejected', 'superseded'];

const MAX_TEXT = 100_000; // generous cap to prevent runaway pastes

// Normalises a request body into an ila_drafts insert/update payload. Trims
// strings, validates admissibility + status enums, normalises documents_required
// into the canonical { type, reason, priority, status } shape.
//
// Pass { skipUndefined: true } for PATCH-style updates.
export function sanitiseDraftPayload(body = {}, { skipUndefined = false } = {}) {
  const out = {};

  function setIfDefined(key, value) {
    if (value === undefined) {
      if (!skipUndefined) out[key] = null;
      return;
    }
    out[key] = value;
  }

  for (const key of [
    'preliminary_view',
    'admissibility_reasoning',
    'estimate_basis',
    'next_steps',
    'observations',
    'drafted_by',
    'updated_by',
  ]) {
    if (body[key] !== undefined) {
      const v = typeof body[key] === 'string' ? body[key].trim().slice(0, MAX_TEXT) : null;
      out[key] = v === '' ? null : v;
    } else if (!skipUndefined) {
      // skip — don't blank existing values on PATCH
    }
  }

  if (body.admissibility_opinion !== undefined) {
    if (body.admissibility_opinion === null || body.admissibility_opinion === '') {
      out.admissibility_opinion = null;
    } else {
      const valid = ADMISSIBILITY_OPTIONS.map((o) => o.value);
      if (!valid.includes(body.admissibility_opinion)) {
        throw new Error(`admissibility_opinion must be one of: ${valid.join(', ')}`);
      }
      out.admissibility_opinion = body.admissibility_opinion;
    }
  }

  if (body.preliminary_estimate !== undefined) {
    out.preliminary_estimate = numericOrNull(body.preliminary_estimate);
  }

  if (body.expected_fsr_date !== undefined) {
    out.expected_fsr_date = body.expected_fsr_date || null;
  }

  if (body.documents_required !== undefined) {
    out.documents_required = sanitiseChecklist(body.documents_required);
  }

  if (body.cover_data !== undefined && body.cover_data !== null) {
    out.cover_data = typeof body.cover_data === 'object' ? body.cover_data : {};
  }

  if (body.status !== undefined) {
    if (!DRAFT_STATUSES.includes(body.status)) {
      throw new Error(`status must be one of: ${DRAFT_STATUSES.join(', ')}`);
    }
    out.status = body.status;
  }

  return out;
}

export function sanitiseChecklist(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item === 'object' && typeof item.type === 'string' && item.type.trim() !== '')
    .map((item) => ({
      type: item.type.trim().slice(0, 200),
      reason: item.reason ? String(item.reason).trim().slice(0, 500) : '',
      priority: ['high', 'medium', 'low'].includes(item.priority) ? item.priority : 'medium',
      status: ['pending', 'received', 'waived'].includes(item.status) ? item.status : 'pending',
    }));
}

// Compares submitted_at to ila_due_at. Returns { compliant, breach_hours }.
export function computeTatCompliance(submittedAt, ilaDueAt) {
  if (!ilaDueAt) return { compliant: true, breach_hours: 0 };
  const submitted = submittedAt instanceof Date ? submittedAt : new Date(submittedAt);
  const due = new Date(ilaDueAt);
  if (Number.isNaN(submitted.getTime()) || Number.isNaN(due.getTime())) {
    return { compliant: true, breach_hours: 0 };
  }
  const diffMs = submitted.getTime() - due.getTime();
  if (diffMs <= 0) return { compliant: true, breach_hours: 0 };
  return { compliant: false, breach_hours: Math.round(diffMs / (60 * 60 * 1000)) };
}

// TAT countdown for the claim header widget. Returns { ms_remaining,
// hours_remaining, severity, label }.
//   severity: 'green' (>24h) | 'amber' (<=24h) | 'red' (<=6h) | 'breach'
export function tatCountdown(ilaDueAt, now = new Date()) {
  if (!ilaDueAt) return null;
  const due = new Date(ilaDueAt);
  if (Number.isNaN(due.getTime())) return null;

  const ms = due.getTime() - (now instanceof Date ? now.getTime() : new Date(now).getTime());
  const hours = ms / (60 * 60 * 1000);

  let severity;
  let label;
  if (ms < 0) {
    severity = 'breach';
    label = `OVERDUE by ${formatDuration(-ms)}`;
  } else if (hours <= 6) {
    severity = 'red';
    label = `${formatDuration(ms)} left (URGENT)`;
  } else if (hours <= 24) {
    severity = 'amber';
    label = `${formatDuration(ms)} left`;
  } else {
    severity = 'green';
    label = `${formatDuration(ms)} left`;
  }

  return { ms_remaining: ms, hours_remaining: hours, severity, label };
}

function formatDuration(ms) {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const mins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return `${days}d ${restHours}h`;
  }
  return `${hours}h ${mins}m`;
}

function numericOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

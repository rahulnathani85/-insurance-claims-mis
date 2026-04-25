// ============================================================
// lib/comms/killSwitch.js
// ------------------------------------------------------------
// In-process cached reader for comms_config (single-row table).
// All cron + webhook entrypoints call assertCommsEnabled(scope)
// at the top so a manual pause from the admin UI takes effect on
// the very next tick.
//
// Cache:
//   - 60s TTL, kept in module scope for the lifetime of the
//     serverless function instance.
//   - PATCH /api/communications/admin/health calls
//     bustCommsConfigCache() so the cache doesn't outlive a toggle.
//
// Failure mode: if comms_config is unreadable, we fail-OPEN
// (assume not paused) and log a warning. The admin can still
// hard-pause by setting an env var override at the cron route
// level; that's tracked separately.
// ============================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';

const TTL_MS = 60_000;
const SCOPES = new Set([
  'ingestion_paused',
  'classification_paused',
  'execution_paused',
]);

let _cache = null;
let _cachedAt = 0;

export async function getCommsConfig({ bust = false } = {}) {
  const now = Date.now();
  if (!bust && _cache && now - _cachedAt < TTL_MS) {
    return _cache;
  }
  const { data, error } = await supabaseAdmin
    .from('comms_config')
    .select('*')
    .eq('id', 1)
    .single();

  if (error || !data) {
    console.warn(
      '[comms/killSwitch] read failed; defaulting to enabled:',
      error?.message || 'no row'
    );
    _cache = {
      ingestion_paused: false,
      classification_paused: false,
      execution_paused: false,
      ingestion_paused_at: null,
      classification_paused_at: null,
      execution_paused_at: null,
    };
  } else {
    _cache = data;
  }
  _cachedAt = now;
  return _cache;
}

// Returns { paused: bool, since: ISO string|null }.
// Throws if `scope` is not a known kill-switch column.
export async function assertCommsEnabled(scope, { bust = false } = {}) {
  if (!SCOPES.has(scope)) {
    throw new Error(`Unknown kill-switch scope: ${scope}`);
  }
  const cfg = await getCommsConfig({ bust });
  const paused = !!cfg[scope];
  // 'ingestion_paused' -> 'ingestion_paused_at'
  const sinceCol = `${scope}_at`;
  return {
    paused,
    since: paused ? cfg[sinceCol] || null : null,
  };
}

// Force the next read to skip the cache. Call this immediately after
// updating comms_config so the very next cron tick sees the new state.
export function bustCommsConfigCache() {
  _cache = null;
  _cachedAt = 0;
}

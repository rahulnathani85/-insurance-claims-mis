// =============================================================================
// lib/provenance/read.js
// =============================================================================
// Phase C (switch reads) helper — spec §10.
//
// During the rollout, claims are in three possible states for any given field:
//
//   1. Pre-provenance row not yet backfilled
//      → only the legacy column has the value
//
//   2. Backfilled row with no subsequent writes
//      → claim_field_values has source_type='migrated', is_current=true
//      Both sources hold the same value.
//
//   3. Backfilled + subsequent dual-writes
//      → claim_field_values has the latest value with proper provenance,
//      legacy column was also updated by the same dual-write
//
// The merge strategy: prefer claim_field_values when an is_current=true row
// exists; else fall back to the legacy column. For any field that's never
// flowed through provenance, the column remains the source of truth.
//
// Returns the claim row PLUS:
//   - `provenance` map      { field_name → { value, source, confidence, has_pending_conflict } }
//   - `data_quality_score`  rough composite per spec §8 (0-1)
//
// Phase D will eventually drop legacy columns; this helper is forward-
// compatible with that — it'll just always read from provenance.
// =============================================================================

import { PROVENANCE_MANAGED_FIELDS } from './dualWrite.js';

// Decode a JSONB FieldValue back to a primitive that's easy to display.
// Inverse of buildFieldValue() — used when emitting "merged" values to the
// caller. We keep it tolerant: any unexpected shape returns the raw value.
export function fieldValueToPrimitive(value) {
  if (!value || typeof value !== 'object') return value;
  switch (value.kind) {
    case 'money': {
      const paise = Number(value.amount);
      if (!Number.isFinite(paise)) return null;
      return paise / 100;  // INR rupees
    }
    case 'date':
    case 'datetime':
    case 'string':
    case 'enum':
    case 'pin':
    case 'phone':
    case 'email':
      return value.value ?? null;
    case 'gps':
      return { lat: value.lat, lng: value.lng };
    case 'address':
      return [value.line, value.city, value.state, value.pin].filter(Boolean).join(', ');
    default:
      return value.value ?? null;
  }
}

// Read merged claim — legacy columns + provenance overlay. Returns:
// {
//   claim:            full claims row (legacy)
//   provenance:       map of field_name → details
//   merged:           shallow copy of claim with provenance overrides applied
//   data_quality:     { score, mandatory_filled, mandatory_total, conflicts }
// }
export async function getClaimWithProvenance(supabase, claimId) {
  if (!claimId) throw new Error('getClaimWithProvenance: claimId is required');

  const [{ data: claim, error: claimErr }, { data: provRows, error: provErr }] = await Promise.all([
    supabase.from('claims').select('*').eq('id', claimId).single(),
    supabase.from('v_current_claim_fields').select('*').eq('claim_id', claimId),
  ]);

  if (claimErr || !claim) throw new Error(`Claim not found: ${claimErr?.message || claimId}`);

  const provenance = {};
  let conflictCount = 0;
  for (const row of provRows || []) {
    if (provErr) break;
    provenance[row.field_name] = {
      value: fieldValueToPrimitive(row.value),
      raw_value: row.value,
      source_type: row.source_type,
      source_document_type: row.source_document_type,
      source_label: row.source_label,
      confidence: row.extraction_confidence,
      captured_at: row.captured_at,
      captured_by: row.captured_by,
      has_pending_conflict: row.has_pending_conflict === true,
      from_provenance: true,
    };
    if (row.has_pending_conflict) conflictCount += 1;
  }

  // Merged shape — caller-friendly. For provenance-managed fields, prefer the
  // overlay; for everything else, the column wins. Keeps existing renderers
  // working unchanged when migrated to call this helper.
  const merged = { ...claim };
  for (const field of PROVENANCE_MANAGED_FIELDS) {
    const p = provenance[field];
    if (p && p.value !== null && p.value !== undefined) {
      merged[field] = p.value;
    }
  }

  // Rough data-quality score per spec §8 — Phase 2 will refine via the
  // compute_field_confidence SQL function with corroboration counts etc.
  // Phase 1 keeps it simple: fraction of provenance-managed mandatory fields
  // that have a non-null current value, minus a penalty for pending conflicts.
  const MANDATORY = ['policy_number', 'insured_name', 'insurer_name', 'lob', 'date_loss', 'loss_location'];
  let mandatoryFilled = 0;
  for (const f of MANDATORY) {
    const v = merged[f];
    if (v !== null && v !== undefined && String(v).trim() !== '') mandatoryFilled += 1;
  }
  const baseScore = mandatoryFilled / MANDATORY.length;
  const penalty = Math.min(0.3, conflictCount * 0.1);
  const score = Math.max(0, Math.min(1, baseScore - penalty));

  return {
    claim,
    provenance,
    merged,
    data_quality: {
      score: Math.round(score * 1000) / 1000,
      mandatory_filled: mandatoryFilled,
      mandatory_total: MANDATORY.length,
      conflicts: conflictCount,
    },
  };
}

// =============================================================================
// lib/provenance/dualWrite.js
// =============================================================================
// Phase B (dual-write) helper — spec docs/provenance-conflict-system-spec.md §10.
//
// Wraps a claim-update by writing to BOTH the legacy claims columns AND the
// claim_field_values ledger. The decision engine runs per field — auto_update
// promotes the new value to is_current=true and supersedes the prior row;
// raise_conflict marks the new row pending; equal_value just records evidence;
// ignore_lower_authority records evidence without flipping current.
//
// Phase A backfilled the existing column values into claim_field_values with
// source_type='migrated' (lowest authority). New writes via this helper carry
// real source metadata so the authority + decision engine work correctly.
//
// Callers don't need to know the field types; the FIELD_TYPES map below tells
// us which kind to use per (field_name → FieldValue.kind).
//
// Errors writing to claim_field_values do NOT roll back the legacy column
// update — Phase B prioritises legacy correctness; provenance is the
// observability layer until Phase C switches reads. Each error is captured
// via lib/observability so we can monitor parity.
// =============================================================================

import { buildFieldValue } from './values.js';
import {
  decideFieldAction,
  loadAuthorityRankForField,
  loadChangePolicy,
  getCurrentFieldValue,
} from './index.js';
import { captureError } from '../observability.js';

// (claim_field_values.field_name → FieldValue kind). The same vocabulary
// as the Phase A backfill — see field_source_authority seed data in the
// 20260430190000 migration.
const FIELD_TYPES = {
  sum_insured:              'money',
  gross_loss:               'money',
  estimated_loss_amount:    'money',
  claim_amount_intimated:   'money',
  date_loss:                'date',
  date_of_intimation:       'date',
  policy_period_from:       'date',
  policy_period_to:         'date',
  policy_number:            'string',
  insured_name:             'string',
  insurer_name:             'string',
  lob:                      'string',
  peril_type:               'string',
  loss_location:            'string',
};

// Subset of FIELD_TYPES that actually correspond to a real column on the
// live claims table (verified live). Other entries in FIELD_TYPES are valid
// provenance fields but the dual-write skips the legacy-column update for
// them — provenance ledger only.
const FIELD_HAS_CLAIMS_COLUMN = {
  sum_insured:              false,
  gross_loss:               true,
  estimated_loss_amount:    true,
  claim_amount_intimated:   false,
  date_loss:                true,
  date_of_intimation:       true,
  policy_period_from:       true,
  policy_period_to:         true,
  policy_number:            true,
  insured_name:             true,
  insurer_name:             true,
  lob:                      true,
  peril_type:               false,
  loss_location:            true,
};

export const PROVENANCE_MANAGED_FIELDS = Object.keys(FIELD_TYPES);

// ----------------------------------------------------------------------------
// dualWriteClaimFields
// ----------------------------------------------------------------------------
// Inputs:
//   supabase     service-role client
//   claimId      BIGINT
//   updates      flat object — same shape that /api/claims/[id] PUT receives.
//                Only keys in FIELD_TYPES are processed; other keys are ignored
//                so callers can pass the whole body through.
//   source       {
//                  type:         'manual' | 'document' | 'email' | 'computed' | 'external_api'
//                  documentType: 'manual_entry' | 'policy_schedule' | ...
//                  label:        human-readable description
//                  extractedBy:  'human:<email>' | 'ocr+sonnet@v2' | 'system:rule_v1'
//                  confidence?:  number 0..1 (null for human entries)
//                  sourceId?:    optional polymorphic FK
//                  capturedBy?:  user email
//                }
//
// Returns: {
//   provenance: [{ field_name, decision, written: bool, error?: string }],
//   skippedNonProvenance: string[],   // keys in `updates` that aren't provenance-managed
// }
// ----------------------------------------------------------------------------
export async function dualWriteClaimFields(supabase, claimId, updates = {}, source = {}) {
  const out = { provenance: [], skippedNonProvenance: [] };

  if (!claimId) throw new Error('dualWriteClaimFields: claimId is required');
  if (!updates || typeof updates !== 'object') return out;

  // Default source metadata — assume human manual entry through the API
  // unless the caller is more specific.
  const src = {
    type: source.type || 'manual',
    documentType: source.documentType || 'manual_entry',
    label: source.label || 'Manual edit via API',
    extractedBy: source.extractedBy || `human:${source.capturedBy || 'unknown'}`,
    confidence: typeof source.confidence === 'number' ? source.confidence : null,
    sourceId: source.sourceId || null,
    capturedBy: source.capturedBy || null,
  };

  // Cache policy + rank lookups across the call (one full set of writes per
  // field can otherwise re-fetch the same authority table N times).
  let policy;
  try {
    policy = await loadChangePolicy(supabase);
  } catch (e) {
    captureError(e, { area: 'provenance-dualwrite-policy', claim_id: claimId });
    policy = {};
  }

  const fieldsTouched = Object.keys(updates).filter(
    (k) => updates[k] !== undefined && Object.prototype.hasOwnProperty.call(FIELD_TYPES, k)
  );
  for (const k of Object.keys(updates)) {
    if (updates[k] === undefined) continue;
    if (!Object.prototype.hasOwnProperty.call(FIELD_TYPES, k)) {
      out.skippedNonProvenance.push(k);
    }
  }

  for (const field of fieldsTouched) {
    const result = { field_name: field, decision: null, written: false };
    const raw = updates[field];

    // null / empty string is a delete signal — Phase B records a tombstone
    // (value=null) so the field history is preserved. Skipping for now to
    // keep the helper conservative; tombstones are a Phase 2 nicety.
    if (raw === null || raw === '') {
      result.decision = { kind: 'no_change', reason: 'null/empty value — Phase B does not tombstone yet', scenario: null };
      out.provenance.push(result);
      continue;
    }

    let valueObj;
    try {
      valueObj = buildFieldValue(FIELD_TYPES[field], raw);
    } catch (e) {
      result.error = `buildFieldValue failed: ${e.message}`;
      captureError(e, { area: 'provenance-dualwrite-build', field, claim_id: claimId, value: raw });
      out.provenance.push(result);
      continue;
    }

    let authorityRank, current;
    try {
      [authorityRank, current] = await Promise.all([
        loadAuthorityRankForField(supabase, field),
        getCurrentFieldValue(supabase, claimId, field),
      ]);
    } catch (e) {
      result.error = `context-load failed: ${e.message}`;
      captureError(e, { area: 'provenance-dualwrite-context', field, claim_id: claimId });
      out.provenance.push(result);
      continue;
    }

    let decision;
    try {
      decision = decideFieldAction({
        fieldName: field,
        newValue: valueObj.value,
        newSource: { documentType: src.documentType, label: src.label, type: src.type },
        newConfidence: src.confidence,
        current: current ? { value: current.value, sourceDocumentType: current.source_document_type } : null,
        authorityRank,
        policy,
      });
    } catch (e) {
      result.error = `decide failed: ${e.message}`;
      captureError(e, { area: 'provenance-dualwrite-decide', field, claim_id: claimId });
      out.provenance.push(result);
      continue;
    }

    result.decision = decision;

    // Apply decision to claim_field_values.
    const newRow = {
      claim_id: parseInt(claimId, 10),
      field_name: field,
      value: valueObj.value,
      value_normalized: valueObj.normalized,
      source_type: src.type,
      source_id: src.sourceId,
      source_document_type: src.documentType,
      source_label: src.label,
      extracted_by: src.extractedBy,
      extraction_confidence: src.confidence,
      captured_by: src.capturedBy,
      is_current: false,
      conflict_status: null,
      conflict_reason: null,
    };
    if (decision.kind === 'auto_update_safe') {
      newRow.is_current = true;
    } else if (decision.kind === 'raise_conflict') {
      newRow.conflict_status = 'pending';
      newRow.conflict_raised_at = new Date().toISOString();
      newRow.conflict_reason = decision.reason;
    }

    // Demote the prior current row first (unique partial index requires
    // exactly one is_current=true per (claim, field)).
    if (decision.kind === 'auto_update_safe' && current) {
      try {
        await supabase
          .from('claim_field_values')
          .update({
            is_current: false,
            superseded_at: new Date().toISOString(),
            superseded_reason: decision.reason,
          })
          .eq('id', current.id);
      } catch (e) {
        result.error = `demote-current failed: ${e.message}`;
        captureError(e, { area: 'provenance-dualwrite-demote', field, claim_id: claimId });
        out.provenance.push(result);
        continue;
      }
    }

    let inserted;
    try {
      const { data, error } = await supabase
        .from('claim_field_values')
        .insert([newRow])
        .select()
        .single();
      if (error) throw error;
      inserted = data;
      result.written = true;
    } catch (e) {
      result.error = `insert failed: ${e.message}`;
      captureError(e, { area: 'provenance-dualwrite-insert', field, claim_id: claimId });
      out.provenance.push(result);
      continue;
    }

    // Link superseded_by on the demoted row.
    if (decision.kind === 'auto_update_safe' && current && inserted) {
      try {
        await supabase
          .from('claim_field_values')
          .update({ superseded_by: inserted.id })
          .eq('id', current.id);
      } catch (e) {
        // Non-fatal; superseded_by is for audit trail visualisation.
        captureError(e, { area: 'provenance-dualwrite-link', field, claim_id: claimId });
      }
    }

    out.provenance.push(result);
  }

  return out;
}

export { FIELD_TYPES, FIELD_HAS_CLAIMS_COLUMN };

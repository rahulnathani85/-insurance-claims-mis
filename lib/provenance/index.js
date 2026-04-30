// =============================================================================
// lib/provenance/index.js
// =============================================================================
// Public surface of the provenance module + DB-aware orchestration helpers.
//
// Pure helpers (no DB) live in:
//   - values.js       buildFieldValue, valuesEqual, VALUE_KINDS
//   - decide.js       decideFieldAction, classifyScenario, severityFor
//
// This file additionally provides loaders that read field_source_authority
// + field_change_policy from Supabase so callers don't have to hand-craft
// rank functions / policy maps.
// =============================================================================

export { buildFieldValue, valuesEqual, VALUE_KINDS } from './values.js';
export { decideFieldAction, classifyScenario, severityFor, SCENARIOS, ACTIONS } from './decide.js';

// Convenience: build a closure-cached authority lookup from the
// field_source_authority table for a single field.
//
// Falls back to Number.POSITIVE_INFINITY (lowest authority) when the doc
// type isn't in the table — equivalent to "treat as evidence only".
export async function loadAuthorityRankForField(supabase, fieldName) {
  const { data, error } = await supabase
    .from('field_source_authority')
    .select('source_document_type, authority_rank, effective_to')
    .eq('field_name', fieldName);
  if (error) throw error;
  const map = new Map();
  const today = new Date();
  for (const row of data || []) {
    if (row.effective_to && new Date(row.effective_to) < today) continue;
    // If multiple effective rows, keep the lowest rank (highest authority).
    const cur = map.get(row.source_document_type);
    if (cur === undefined || row.authority_rank < cur) {
      map.set(row.source_document_type, row.authority_rank);
    }
  }
  return (documentType) => {
    if (!documentType) return Number.POSITIVE_INFINITY;
    const v = map.get(documentType);
    return v === undefined ? Number.POSITIVE_INFINITY : v;
  };
}

// Convenience: load all field_change_policy rows into the nested-map shape
// decideFieldAction expects. Includes the __default__ pseudo-field.
export async function loadChangePolicy(supabase) {
  const { data, error } = await supabase
    .from('field_change_policy')
    .select('field_name, scenario, action');
  if (error) throw error;
  const policy = {};
  for (const row of data || []) {
    if (!policy[row.field_name]) policy[row.field_name] = {};
    policy[row.field_name][row.scenario] = row.action;
  }
  return policy;
}

// Read the current authoritative value for a (claim, field). Returns null
// when no row has is_current=true.
export async function getCurrentFieldValue(supabase, claimId, fieldName) {
  const { data, error } = await supabase
    .from('claim_field_values')
    .select('id, value, value_normalized, source_type, source_document_type, source_label, extraction_confidence')
    .eq('claim_id', claimId)
    .eq('field_name', fieldName)
    .eq('is_current', true)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Read all evidence rows for a (claim, field), newest first. Used by the
// history pane.
export async function getFieldHistory(supabase, claimId, fieldName) {
  const { data, error } = await supabase
    .from('claim_field_values')
    .select('*')
    .eq('claim_id', claimId)
    .eq('field_name', fieldName)
    .order('captured_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

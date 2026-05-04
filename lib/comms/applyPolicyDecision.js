// =============================================================================
// lib/comms/applyPolicyDecision.js
// =============================================================================
// Submit-time side-effect helper for the Policy Registration Agent. Reads a
// decision row (decision, matched_policy_id, merged_policy_fields,
// new_policy_payload, ...) and performs the corresponding mutation:
//
//   match_existing       → claims.policy_id := matched id
//                          + normalise claim's policy_number / insurer_name
//                            to the master's canonical values
//   create_new           → INSERT into policies, set claims.policy_id to
//                          the new id
//   ambiguous_needs_review → no-op (clerk resolves manually via the
//                            policy-master UI; agent's row is kept for audit)
//
// Errors during create_new (FK / constraint violations) are non-fatal —
// they're logged + the claim row is left with policy_id NULL. The
// registration itself still succeeds.
//
// Called from PUT /api/claims/[id] inside the placeholder→real ref-promotion
// block, alongside the LOB counter increment + folder_path computation.
// =============================================================================

// ---- Whitelist of columns we'll INSERT into `policies` for create_new ----
// Anything outside this list is dropped to avoid surprises if the agent
// hallucinates extra keys. The exact set matches the policies table's
// data columns (excluding id / created_at / company — company is set
// from the claim row, not the agent payload, to enforce tenant scope).
const POLICIES_INSERT_WHITELIST = new Set([
  'policy_number',
  'insurer',
  'insurer_office',
  'insured_name',
  'insured_address',
  'phone',
  'email',
  'lob',
  'policy_type',
  'sum_insured',
  'premium',
  'start_date',
  'end_date',
  'policy_copy_url',
  'risk_location',
  'description',
]);

function sanitiseNewPolicyPayload(raw, companyFromClaim) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!POLICIES_INSERT_WHITELIST.has(k)) continue;
    // The agent normalises dates to DD-MM-YYYY (TEXT); the policies table
    // stores them as TEXT today, so no further coercion needed.
    if (v === '' || v === undefined) continue;
    out[k] = v;
  }
  // Always force company from the claim row — never trust the agent on tenant.
  out.company = companyFromClaim || 'NISLA';
  return out;
}

// ------------------------------------------------------------
// applyPolicyDecision({ supabase, claimId, claimRow, decision })
//
// Returns one of:
//   { policy_id: <int>, applied: 'matched',         conflicts: [...] }
//   { policy_id: <int>, applied: 'created',         new_policy_id }
//   { policy_id: null,  applied: 'review_pending' }
//   { policy_id: null,  applied: 'no_decision' }
//   { policy_id: null,  applied: 'create_failed',   error }
// ------------------------------------------------------------
export async function applyPolicyDecision({ supabase, claimId, claimRow, decision }) {
  if (!supabase) throw new Error('applyPolicyDecision: supabase client required');
  if (!claimId)  throw new Error('applyPolicyDecision: claimId required');
  if (!decision || typeof decision !== 'object') {
    return { policy_id: null, applied: 'no_decision' };
  }

  // ----- match_existing -----
  if (decision.decision === 'match_existing' && decision.matched_policy_id != null) {
    const merged = decision.merged_policy_fields || {};
    const masterPolicyNumber = merged?.policy_number?.value || null;
    const masterInsurer      = merged?.insurer?.value || null;

    const updates = { policy_id: decision.matched_policy_id };
    if (masterPolicyNumber) updates.policy_number = masterPolicyNumber;
    if (masterInsurer)      updates.insurer_name  = masterInsurer;

    const { error } = await supabase
      .from('claims')
      .update(updates)
      .eq('id', claimId);

    if (error) {
      console.warn('[applyPolicyDecision/match] update claims failed:', error.message);
      return { policy_id: null, applied: 'match_failed', error: error.message };
    }
    return {
      policy_id: decision.matched_policy_id,
      applied: 'matched',
      conflicts: Array.isArray(decision.conflicts) ? decision.conflicts : [],
    };
  }

  // ----- create_new -----
  if (decision.decision === 'create_new' && decision.new_policy_payload) {
    const payload = sanitiseNewPolicyPayload(
      decision.new_policy_payload,
      claimRow?.company,
    );
    if (!payload || !payload.policy_number) {
      return { policy_id: null, applied: 'create_failed', error: 'payload missing policy_number' };
    }

    const { data: newPolicy, error: pErr } = await supabase
      .from('policies')
      .insert([payload])
      .select('id')
      .single();

    if (pErr || !newPolicy) {
      console.warn('[applyPolicyDecision/create] policies insert failed:', pErr?.message);
      return { policy_id: null, applied: 'create_failed', error: pErr?.message || 'insert returned null' };
    }

    const { error: cErr } = await supabase
      .from('claims')
      .update({ policy_id: newPolicy.id })
      .eq('id', claimId);

    if (cErr) {
      console.warn('[applyPolicyDecision/create] claims FK update failed:', cErr.message);
      return { policy_id: null, applied: 'create_failed', error: cErr.message, new_policy_id: newPolicy.id };
    }

    return { policy_id: newPolicy.id, applied: 'created', new_policy_id: newPolicy.id };
  }

  // ----- ambiguous_needs_review or unknown -----
  return { policy_id: null, applied: 'review_pending' };
}

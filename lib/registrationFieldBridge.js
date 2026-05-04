// =============================================================================
// lib/registrationFieldBridge.js
// =============================================================================
// Pure helpers that run BETWEEN the Claim Registration Agent and the form's
// downstream consumers. They:
//
//   1. derivePinFromLocation(fields)
//      Pulls a 6-digit Indian PIN out of the loss_location address text when
//      loss_location_pin came back empty. Saves an LLM round-trip for the
//      common case where the address already contains the PIN.
//
//   2. bridgePolicyDecisionIntoFields(fields, policyDecision)
//      Backfills policy-master facts (policy_number, policy_period_from,
//      policy_period_to, sum_insured, policy_type) from the Policy Agent's
//      decision into the claim fields map — but ONLY where the claim agent
//      came back null/empty or below 0.5 confidence. The policy agent has
//      cross-verified against the master so we trust it more for these
//      specific fields than a low-confidence LLM extraction.
//
// Both helpers are pure (no I/O), so vitest can exercise them directly.
// =============================================================================

// ---------- derivePinFromLocation ------------------------------------------
//
// Returns a NEW fields object. Doesn't mutate the input.
//
// Behaviour:
//   - If loss_location_pin already has a non-empty value → return fields as-is.
//   - Otherwise scan loss_location.value for a 6-digit token whose first digit
//     is 1–9 (Indian PIN format) bordered by non-digit chars or string ends.
//     The first match wins; if none, fields are untouched.
//
// Confidence is set to 0.7 — deterministic regex match but the input could
// embed a non-PIN 6-digit number. The form renders this as a yellow "med"
// badge so the clerk can sanity-check.
// ---------------------------------------------------------------------------
export function derivePinFromLocation(fields) {
  if (!fields || typeof fields !== 'object') return fields;

  const pinEntry = fields.loss_location_pin;
  const pinIsEmpty =
    !pinEntry ||
    pinEntry.value === null ||
    pinEntry.value === undefined ||
    String(pinEntry.value).trim() === '';
  if (!pinIsEmpty) return fields;

  const locText = fields.loss_location?.value;
  if (!locText || typeof locText !== 'string') return fields;

  // Indian PIN: 6 digits, first digit 1–9, surrounded by non-digit characters
  // or string boundaries. The non-capturing wrappers exclude the boundary
  // chars from the captured group itself.
  const m = locText.match(/(?:^|[^0-9])([1-9]\d{5})(?:[^0-9]|$)/);
  if (!m) return fields;

  const pin = m[1];
  const idx = locText.indexOf(pin);
  return {
    ...fields,
    loss_location_pin: {
      value: pin,
      confidence: 0.7,
      source: 'derived_from_loss_location',
      raw_snippet: locText.slice(Math.max(0, idx - 20), idx + pin.length + 20),
    },
  };
}

// ---------- bridgePolicyDecisionIntoFields ---------------------------------
//
// Translates the Policy Agent's vocabulary onto the claim form's vocabulary
// and overlays the master's facts where the Claim Agent didn't extract them
// confidently.
//
// Inputs:
//   claimFields    — the parsed Claim Agent `fields` map
//                    (each entry: { value, confidence, source, raw_snippet })
//   policyDecision — the parsed Policy Agent output. Only these decisions
//                    contribute fields:
//                      'match_existing' → uses merged_policy_fields (each
//                                         entry: { value, source })
//                      'create_new'     → uses new_policy_payload (flat
//                                         object with raw values)
//                    Anything else (ambiguous_needs_review, null, etc.) is a
//                    no-op — claimFields is returned unchanged.
//
// Mapping:
//   policy_number          → policy_number
//   start_date             → policy_period_from
//   end_date               → policy_period_to
//   sum_insured            → sum_insured
//   policy_type            → policy_type
//
// Overwrite rule: a claim-agent entry is overwritten when its value is
// null/empty OR its confidence < 0.5 (matching the form's old auto-fill
// floor — values above that bar were trusted to land in the input even
// before this bridge was added). Bridged fields are tagged
// source='policy_agent_bridge', confidence=0.85.
// ---------------------------------------------------------------------------

const POLICY_AGENT_TO_CLAIM_FORM = [
  { policyKey: 'policy_number', formKey: 'policy_number' },
  { policyKey: 'start_date',    formKey: 'policy_period_from' },
  { policyKey: 'end_date',      formKey: 'policy_period_to' },
  { policyKey: 'sum_insured',   formKey: 'sum_insured' },
  { policyKey: 'policy_type',   formKey: 'policy_type' },
];

const BRIDGE_CONFIDENCE = 0.85;

export function bridgePolicyDecisionIntoFields(claimFields, policyDecision) {
  if (!claimFields || typeof claimFields !== 'object') return claimFields;
  if (!policyDecision || typeof policyDecision !== 'object') return claimFields;

  const decision = policyDecision.decision;
  if (decision !== 'match_existing' && decision !== 'create_new') {
    return claimFields;
  }

  const out = { ...claimFields };

  for (const { policyKey, formKey } of POLICY_AGENT_TO_CLAIM_FORM) {
    const policyValue = readPolicyValue(policyDecision, policyKey, decision);
    if (policyValue === null || policyValue === undefined || policyValue === '') {
      continue;
    }
    if (!shouldOverwrite(out[formKey])) continue;
    out[formKey] = {
      value: policyValue,
      confidence: BRIDGE_CONFIDENCE,
      source: 'policy_agent_bridge',
      raw_snippet: '',
    };
  }

  return out;
}

function readPolicyValue(decision, key, kind) {
  if (kind === 'match_existing') {
    const m = decision.merged_policy_fields;
    if (!m || typeof m !== 'object') return null;
    const entry = m[key];
    if (!entry || typeof entry !== 'object') return null;
    return entry.value ?? null;
  }
  // create_new
  const p = decision.new_policy_payload;
  if (!p || typeof p !== 'object') return null;
  return p[key] ?? null;
}

function shouldOverwrite(existingEntry) {
  if (!existingEntry || typeof existingEntry !== 'object') return true;
  const v = existingEntry.value;
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
    return true;
  }
  const conf = existingEntry.confidence;
  if (conf === null || conf === undefined) return false; // unknown confidence
                                                          // but a value is set
                                                          // — leave it alone
  return Number(conf) < 0.5;
}

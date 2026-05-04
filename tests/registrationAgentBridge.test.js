// =============================================================================
// tests/registrationAgentBridge.test.js
// =============================================================================
// Pure-logic tests for the helpers that sit BETWEEN the Claim Registration
// Agent and the form/UI. Targets:
//
//   - lib/registrationFieldBridge.js  (derivePinFromLocation, bridgePolicyDecisionIntoFields)
//   - lib/comms/prompts/registrationAgentPrompt.js  (validateLobSubcategoryField)
//
// Vitest, Node env. The route that wires them together is integration territory.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  derivePinFromLocation,
  bridgePolicyDecisionIntoFields,
} from '../lib/registrationFieldBridge.js';
import { validateLobSubcategoryField } from '../lib/comms/prompts/registrationAgentPrompt.js';

// Helper: build a claim-agent-shaped field entry.
function f(value, confidence = 0.9, source = 'email') {
  return { value, confidence, source, raw_snippet: '' };
}

// =========================================================================
// derivePinFromLocation
// =========================================================================

describe('derivePinFromLocation', () => {
  it('extracts a 6-digit PIN from a typical Indian address', () => {
    const fields = {
      loss_location: f('Office at Marine Drive, Mumbai 400001, Maharashtra'),
    };
    const out = derivePinFromLocation(fields);
    expect(out.loss_location_pin.value).toBe('400001');
    expect(out.loss_location_pin.confidence).toBe(0.7);
    expect(out.loss_location_pin.source).toBe('derived_from_loss_location');
  });

  it('preserves a non-empty existing PIN', () => {
    const fields = {
      loss_location: f('Office at Marine Drive, Mumbai 400001'),
      loss_location_pin: f('400099', 0.95),
    };
    const out = derivePinFromLocation(fields);
    expect(out.loss_location_pin.value).toBe('400099');
    expect(out.loss_location_pin.confidence).toBe(0.95);
  });

  it('treats an empty-string PIN as missing and derives a new one', () => {
    const fields = {
      loss_location: f('Plot 23, Andheri East, Mumbai 400093'),
      loss_location_pin: f('', 0),
    };
    const out = derivePinFromLocation(fields);
    expect(out.loss_location_pin.value).toBe('400093');
  });

  it('treats null and undefined PIN as missing', () => {
    const a = derivePinFromLocation({
      loss_location: f('Plot 23, Mumbai 400001'),
      loss_location_pin: f(null, 0),
    });
    expect(a.loss_location_pin.value).toBe('400001');

    const b = derivePinFromLocation({
      loss_location: f('Plot 23, Mumbai 400001'),
    });
    expect(b.loss_location_pin.value).toBe('400001');
  });

  it('returns fields unchanged when there is no loss_location', () => {
    const fields = {};
    const out = derivePinFromLocation(fields);
    expect(out).toBe(fields);
  });

  it('does not match a 6-digit number that starts with 0', () => {
    const fields = { loss_location: f('Sector 0023456 Phase 1') };
    const out = derivePinFromLocation(fields);
    expect(out.loss_location_pin).toBeUndefined();
  });

  it('does not match more or fewer than 6 digits', () => {
    expect(derivePinFromLocation({ loss_location: f('Building 12345 Street') }).loss_location_pin).toBeUndefined();
    expect(derivePinFromLocation({ loss_location: f('Building 1234567 Street') }).loss_location_pin).toBeUndefined();
  });

  it('finds PIN preceded by labels like "PIN:" or "Pincode -"', () => {
    expect(derivePinFromLocation({ loss_location: f('Plot 7, Pune. PIN: 411001') }).loss_location_pin.value).toBe('411001');
    expect(derivePinFromLocation({ loss_location: f('Plot 7, Pune. Pincode - 411001') }).loss_location_pin.value).toBe('411001');
    expect(derivePinFromLocation({ loss_location: f('Plot 7, Pune (411001)') }).loss_location_pin.value).toBe('411001');
  });

  it('takes the first PIN when multiple appear', () => {
    const fields = { loss_location: f('Site A: 400001, Site B: 411001') };
    expect(derivePinFromLocation(fields).loss_location_pin.value).toBe('400001');
  });

  it('records a raw_snippet around the matched PIN for audit', () => {
    const fields = { loss_location: f('Office at Marine Drive, Mumbai 400001, Maharashtra') };
    const out = derivePinFromLocation(fields);
    expect(out.loss_location_pin.raw_snippet).toContain('400001');
  });

  it('handles non-object fields safely', () => {
    expect(derivePinFromLocation(null)).toBeNull();
    expect(derivePinFromLocation(undefined)).toBeUndefined();
  });
});

// =========================================================================
// bridgePolicyDecisionIntoFields
// =========================================================================

describe('bridgePolicyDecisionIntoFields — match_existing', () => {
  const matchDecision = {
    decision: 'match_existing',
    matched_policy_id: 42,
    merged_policy_fields: {
      policy_number: { value: 'POL/12/345', source: 'master' },
      start_date:    { value: '01-04-2025', source: 'master' },
      end_date:      { value: '31-03-2026', source: 'master' },
      sum_insured:   { value: 5000000, source: 'master' },
      policy_type:   { value: 'SFSP', source: 'master' },
    },
  };

  it('backfills all 5 fields when claim agent left them null', () => {
    const claimFields = {};
    const out = bridgePolicyDecisionIntoFields(claimFields, matchDecision);
    expect(out.policy_number.value).toBe('POL/12/345');
    expect(out.policy_period_from.value).toBe('01-04-2025');
    expect(out.policy_period_to.value).toBe('31-03-2026');
    expect(out.sum_insured.value).toBe(5000000);
    expect(out.policy_type.value).toBe('SFSP');
  });

  it('tags bridged fields with confidence 0.85 and source policy_agent_bridge', () => {
    const out = bridgePolicyDecisionIntoFields({}, matchDecision);
    expect(out.policy_number.confidence).toBe(0.85);
    expect(out.policy_number.source).toBe('policy_agent_bridge');
  });

  it('leaves a confident claim-agent value alone (>= 0.5)', () => {
    const claimFields = {
      policy_number: f('CLAIM/99/9', 0.95, 'email'),
    };
    const out = bridgePolicyDecisionIntoFields(claimFields, matchDecision);
    expect(out.policy_number.value).toBe('CLAIM/99/9');
    expect(out.policy_number.source).toBe('email');
  });

  it('overwrites a low-confidence claim-agent value (< 0.5)', () => {
    const claimFields = {
      policy_number: f('UNCERTAIN-MAYBE', 0.3, 'ocr_scan'),
    };
    const out = bridgePolicyDecisionIntoFields(claimFields, matchDecision);
    expect(out.policy_number.value).toBe('POL/12/345');
    expect(out.policy_number.source).toBe('policy_agent_bridge');
  });

  it('overwrites an empty string value regardless of confidence', () => {
    const claimFields = { sum_insured: f('', 0.95) };
    const out = bridgePolicyDecisionIntoFields(claimFields, matchDecision);
    expect(out.sum_insured.value).toBe(5000000);
  });

  it('skips bridge for fields the master decision does not include', () => {
    const partialMatch = {
      decision: 'match_existing',
      merged_policy_fields: {
        policy_number: { value: 'POL/X/Y', source: 'master' },
        // no period / sum_insured / policy_type
      },
    };
    const out = bridgePolicyDecisionIntoFields({}, partialMatch);
    expect(out.policy_number.value).toBe('POL/X/Y');
    expect(out.policy_period_from).toBeUndefined();
    expect(out.sum_insured).toBeUndefined();
  });

  it('skips a master entry whose value is null', () => {
    const decision = {
      decision: 'match_existing',
      merged_policy_fields: {
        policy_number: { value: null, source: 'master' },
      },
    };
    const out = bridgePolicyDecisionIntoFields({}, decision);
    expect(out.policy_number).toBeUndefined();
  });
});

describe('bridgePolicyDecisionIntoFields — create_new', () => {
  const createDecision = {
    decision: 'create_new',
    new_policy_payload: {
      policy_number: 'POL/NEW/1',
      start_date:    '01-04-2025',
      end_date:      '31-03-2026',
      sum_insured:   1000000,
      policy_type:   'IAR',
    },
  };

  it('backfills from new_policy_payload when claim fields empty', () => {
    const out = bridgePolicyDecisionIntoFields({}, createDecision);
    expect(out.policy_number.value).toBe('POL/NEW/1');
    expect(out.policy_period_from.value).toBe('01-04-2025');
    expect(out.policy_period_to.value).toBe('31-03-2026');
    expect(out.sum_insured.value).toBe(1000000);
    expect(out.policy_type.value).toBe('IAR');
  });

  it('respects high-confidence claim-agent values over create_new', () => {
    const claimFields = { policy_number: f('CLAIM-OWN', 0.9) };
    const out = bridgePolicyDecisionIntoFields(claimFields, createDecision);
    expect(out.policy_number.value).toBe('CLAIM-OWN');
  });
});

describe('bridgePolicyDecisionIntoFields — no-op cases', () => {
  it('returns claim fields unchanged for ambiguous_needs_review', () => {
    const claimFields = { policy_number: f('X', 0.4) };
    const out = bridgePolicyDecisionIntoFields(claimFields, {
      decision: 'ambiguous_needs_review',
      review_reasons: ['multiple matches'],
    });
    expect(out).toEqual(claimFields);
  });

  it('returns claim fields unchanged for null decision', () => {
    const claimFields = { policy_number: f('X', 0.4) };
    expect(bridgePolicyDecisionIntoFields(claimFields, null)).toBe(claimFields);
    expect(bridgePolicyDecisionIntoFields(claimFields, undefined)).toBe(claimFields);
  });

  it('returns claim fields unchanged for unknown decision strings', () => {
    const claimFields = { policy_number: f('X', 0.4) };
    const out = bridgePolicyDecisionIntoFields(claimFields, { decision: 'pending' });
    expect(out).toEqual(claimFields);
  });

  it('handles malformed claimFields safely', () => {
    expect(bridgePolicyDecisionIntoFields(null, { decision: 'match_existing', merged_policy_fields: {} })).toBeNull();
  });
});

// =========================================================================
// validateLobSubcategoryField (from lib/comms/prompts/registrationAgentPrompt.js)
// =========================================================================

describe('validateLobSubcategoryField', () => {
  it('keeps a valid Fire sub-category when LOB is Fire', () => {
    const fields = {
      lob: f('Fire', 0.95),
      lob_subcategory: f('SFSP (Standard Fire & Special Perils)', 0.8),
    };
    const out = validateLobSubcategoryField(fields);
    expect(out.lob_subcategory.value).toBe('SFSP (Standard Fire & Special Perils)');
    expect(out.lob_subcategory.confidence).toBe(0.8);
  });

  it('clears a sub-category that does not belong to the chosen LOB', () => {
    const fields = {
      lob: f('Fire', 0.95),
      lob_subcategory: f('Hull & Machinery Policy', 0.9),  // Marine Hull, not Fire
    };
    const out = validateLobSubcategoryField(fields);
    expect(out.lob_subcategory.value).toBeNull();
    expect(out.lob_subcategory.confidence).toBe(0);
    expect(out.lob_subcategory.source).toBe('rejected_invalid_for_lob');
  });

  it('clears an invented sub-category not in the canonical list', () => {
    const fields = {
      lob: f('Fire', 0.95),
      lob_subcategory: f('Super Fire Plus Policy', 0.7),
    };
    const out = validateLobSubcategoryField(fields);
    expect(out.lob_subcategory.value).toBeNull();
  });

  it('caps confidence at 0.4 when LOB is unknown', () => {
    const fields = {
      lob: f(null, 0),
      lob_subcategory: f('Some Sub', 0.9),
    };
    const out = validateLobSubcategoryField(fields);
    expect(out.lob_subcategory.value).toBe('Some Sub');
    expect(out.lob_subcategory.confidence).toBeLessThanOrEqual(0.4);
  });

  it('returns fields unchanged when lob_subcategory is empty', () => {
    const fields = { lob: f('Fire', 0.9) };
    const out = validateLobSubcategoryField(fields);
    expect(out).toBe(fields);
  });

  it('returns fields unchanged when lob_subcategory.value is null/empty', () => {
    const fields = {
      lob: f('Fire', 0.9),
      lob_subcategory: f(null, 0),
    };
    const out = validateLobSubcategoryField(fields);
    expect(out).toBe(fields);
  });

  it('handles non-object input safely', () => {
    expect(validateLobSubcategoryField(null)).toBeNull();
    expect(validateLobSubcategoryField(undefined)).toBeUndefined();
  });
});

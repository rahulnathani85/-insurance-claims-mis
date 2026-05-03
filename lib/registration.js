// =============================================================================
// lib/registration.js
// =============================================================================
// Pure helpers for the claim registration flow (spec §6, §10).
//
// Decoupled from any HTTP / Supabase concerns so it's trivially unit-testable
// (see tests/registration.test.js). The /api/claims/[id]/register route wires
// these helpers up to the DB.
// =============================================================================

// -----------------------------------------------------------------------------
// Tier thresholds (spec §6) — keep in INR rupees
// -----------------------------------------------------------------------------
export const COMPLEXITY_THRESHOLDS = {
  small_max:    100_000,        // < 1 lakh
  standard_max: 5_000_000,      // 1L - 50L
  large_max:    50_000_000,     // 50L - 5Cr
  // anything above 5Cr OR is_catastrophe=true => 'cat'
};

// FSR TAT in days (spec §6)
export const FSR_TAT_DAYS = {
  small:    30,
  standard: 30,
  large:    45,
  cat:      90,
};

// ILA TAT is always 72 hours (spec §6)
export const ILA_TAT_HOURS = 72;

// -----------------------------------------------------------------------------
// computeComplexityTier — spec §6
// -----------------------------------------------------------------------------
// Inputs (any one of `estimated_loss`, `gross_loss`, `claim_amount_intimated`
// can drive the decision; we pick the most reliable in that order):
//   - estimated_loss          NUMERIC | null   surveyor's preliminary estimate
//   - gross_loss              NUMERIC | null   insurer-stated gross
//   - claim_amount_intimated  NUMERIC | null   amount on intimation
//   - is_catastrophe          BOOLEAN          forces 'cat' regardless
//
// Returns: 'small' | 'standard' | 'large' | 'cat' | null (if no signal)
// -----------------------------------------------------------------------------
export function computeComplexityTier({
  estimated_loss = null,
  gross_loss = null,
  claim_amount_intimated = null,
  is_catastrophe = false,
} = {}) {
  if (is_catastrophe === true) return 'cat';

  // Pick the first non-null, non-zero amount in priority order.
  const candidates = [estimated_loss, gross_loss, claim_amount_intimated];
  const amount = candidates.find(v => v !== null && v !== undefined && Number(v) > 0);
  if (amount === undefined) return null;

  const n = Number(amount);
  if (n < COMPLEXITY_THRESHOLDS.small_max) return 'small';
  if (n < COMPLEXITY_THRESHOLDS.standard_max) return 'standard';
  if (n < COMPLEXITY_THRESHOLDS.large_max) return 'large';
  return 'cat';
}

// -----------------------------------------------------------------------------
// computeIlaDueAt — spec §6: registered_at + 72h
// -----------------------------------------------------------------------------
// Returns an ISO timestamp string.
// -----------------------------------------------------------------------------
export function computeIlaDueAt(registeredAt) {
  const base = new Date(registeredAt);
  if (Number.isNaN(base.getTime())) {
    throw new Error('computeIlaDueAt: registeredAt is not a valid date');
  }
  return new Date(base.getTime() + ILA_TAT_HOURS * 60 * 60 * 1000).toISOString();
}

// -----------------------------------------------------------------------------
// computeFsrDueAt — spec §6: registered_at + (30 / 45 / 90 days based on tier)
// -----------------------------------------------------------------------------
export function computeFsrDueAt(registeredAt, complexityTier) {
  const base = new Date(registeredAt);
  if (Number.isNaN(base.getTime())) {
    throw new Error('computeFsrDueAt: registeredAt is not a valid date');
  }
  const days = FSR_TAT_DAYS[complexityTier];
  if (!days) return null; // no tier => no FSR TAT yet
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

// -----------------------------------------------------------------------------
// validateRegistration — spec §10 edge cases
// -----------------------------------------------------------------------------
// Pure: takes the claim shape (the intimation claim being registered).
// Returns: { ok: boolean, errors: string[], warnings: string[] }
//
// errors block registration. warnings are surfaced but allow proceed.
//
// Philosophy (29 Apr 2026): Intimation claims start with sparse data — the
// LLM extraction may have missed fields, and there's no rich registration
// form yet (Slice E not built). Registration should always proceed unless
// the data is *unambiguously wrong* (e.g. future-dated loss). Missing fields
// are warnings the clerk can fill later via inline edit on the claim detail
// page.
// -----------------------------------------------------------------------------
export function validateRegistration(claim, options = {}) {
  const errors = [];
  const warnings = [];

  const today = options.today ? new Date(options.today) : new Date();

  // The actual column on `claims` is `date_loss` (not date_of_loss). The
  // older v3 schema used date_loss; the spec used date_of_loss. We accept
  // either shape so call sites that build a fresh form-style payload still
  // work, but production reads use date_loss.
  const dateLossRaw = claim?.date_loss ?? claim?.date_of_loss ?? null;
  const dateLoss = dateLossRaw ? new Date(dateLossRaw) : null;

  // 1. If date_loss is set, it must be valid AND not in the future
  if (dateLossRaw && (!dateLoss || Number.isNaN(dateLoss.getTime()))) {
    errors.push('date_loss is set but is not a valid date');
  } else if (dateLoss) {
    if (dateLoss.getTime() > today.getTime()) {
      // Future-dated loss is unambiguously wrong → block
      errors.push('date_loss is in the future — cannot register');
    }
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    if (today.getTime() - dateLoss.getTime() > oneYearMs) {
      warnings.push('date_loss is more than 1 year old — likely time-barred');
    }
  } else {
    // date_loss missing — warn but don't block (clerk can fill in later)
    warnings.push('date_loss is missing — fill in via the claim detail page after registration');
  }

  // 2. Policy-period validation (§10) — only HARD-blocks when all three dates
  // are set AND the loss is outside the policy window.
  if (claim?.policy_period_from && claim?.policy_period_to && dateLoss) {
    const pFrom = new Date(claim.policy_period_from);
    const pTo   = new Date(claim.policy_period_to);
    if (!Number.isNaN(pFrom.getTime()) && !Number.isNaN(pTo.getTime())) {
      if (dateLoss < pFrom || dateLoss > pTo) {
        errors.push(
          `date_loss (${dateLossRaw}) is outside policy period ` +
          `(${claim.policy_period_from} to ${claim.policy_period_to})`
        );
      }
    }
  } else if (!claim?.policy_period_from || !claim?.policy_period_to) {
    warnings.push('policy_period not set — period validation skipped');
  }

  // 3. Required fields — soft check (warning, not error). A clerk should be
  // able to register an intimation claim and fill in missing fields after.
  const requiredFields = [
    ['ref_number', 'reference number'],
    ['policy_number', 'policy number'],
    ['insured_name', 'insured name'],
    ['lob', 'line of business'],
  ];
  for (const [key, label] of requiredFields) {
    if (!claim?.[key] || String(claim[key]).trim() === '') {
      warnings.push(`${label} is missing — fill in via the claim detail page`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

// -----------------------------------------------------------------------------
// findDuplicateClaims — spec §10: same insurer + policy + DoL within 7 days
// -----------------------------------------------------------------------------
// Caller must pass a Supabase client with read access to the `claims` table.
// Returns array of {id, ref_number, insured_name, date_of_loss} (excluding the
// claim being registered).
// -----------------------------------------------------------------------------
export async function findDuplicateClaims(supabase, {
  insurerName,
  policyNumber,
  dateOfLoss,
  excludeId,
  windowDays = 7,
}) {
  if (!insurerName || !policyNumber || !dateOfLoss) return [];

  const dol = new Date(dateOfLoss);
  if (Number.isNaN(dol.getTime())) return [];

  const fromDate = new Date(dol.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const toDate   = new Date(dol.getTime() + windowDays * 24 * 60 * 60 * 1000);

  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr   = toDate.toISOString().slice(0, 10);

  let query = supabase
    .from('claims')
    .select('id, ref_number, insured_name, date_loss, status, phase')
    .ilike('insurer_name', insurerName.trim())
    .eq('policy_number', policyNumber.trim())
    .gte('date_loss', fromStr)
    .lte('date_loss', toStr);

  if (excludeId !== undefined && excludeId !== null) {
    query = query.neq('id', excludeId);
  }

  const { data, error } = await query;
  if (error) {
    // Don't fail registration if dup-check itself fails — log and return empty.
    // Duplicate detection is a safety net, not a hard gate.
    console.warn('findDuplicateClaims query failed:', error.message);
    return [];
  }
  return data || [];
}

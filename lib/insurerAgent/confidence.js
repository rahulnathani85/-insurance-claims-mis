// =============================================================================
// lib/insurerAgent/confidence.js
// =============================================================================
// Heuristic helpers that promote / demote individual field confidences after
// the LLM has emitted its first pass. The model self-rates each field as
// 'high' | 'medium' | 'low', but we don't take its word: we run cheap
// deterministic checks (GSTIN checksum, PIN-vs-state, allowed-enum, etc.)
// and override the rating where the evidence is mathematical.
//
// Ordering principle:
//   - Hard validity check fails -> demote to 'low' (model is wrong about
//     a checkable fact)
//   - Hard validity check passes -> promote to 'high' (regardless of what
//     the model said)
//   - No checkable evidence -> leave the model's rating intact
//
// Pure functions only — no DB calls, no I/O. All inputs are JS values.
// =============================================================================

// ---------- GSTIN checksum (the only "verifiable" datum on an insurer) -----
//
// GSTIN format: 15 chars
//   [0..1]   - state code (01..38)
//   [2..11]  - PAN (10 chars: 5 letters + 4 digits + 1 letter)
//   [12]     - entity number (alphanumeric)
//   [13]     - 'Z' (literal)
//   [14]     - check digit (Luhn-like over a base-36 alphabet)
//
// The check digit is computed by applying weights [1,2,1,2,...] to chars 0..13,
// summing each product's quotient + remainder against base 36, taking
// 36 - (sum % 36) mod 36, and indexing into the alphabet 0-9A-Z.
//
// Reference: https://docs.gst.gov.in/api/master/getGstin.json (public spec)
// ---------------------------------------------------------------------------

const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function isValidGSTIN(raw) {
  if (typeof raw !== 'string') return false;
  const s = raw.trim().toUpperCase();
  if (s.length !== 15) return false;
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(s)) return false;

  // Luhn-like checksum.
  const factors = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2];
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_ALPHABET.indexOf(s[i]);
    if (v === -1) return false;
    const product = v * factors[i];
    sum += Math.floor(product / 36) + (product % 36);
  }
  const expected = (36 - (sum % 36)) % 36;
  return GSTIN_ALPHABET[expected] === s[14];
}

// ---------- PIN code vs. state cross-check ----------------------------------
//
// Indian PINs encode the postal region in their first digit, and approximate
// state in the first 2 digits. We check the first-digit-to-region mapping
// because that's the most reliable signal — full-3-digit-to-state is too
// granular to encode by hand (would need a lookup table). First-digit ranges:
//
//   1: Delhi, Haryana, Punjab, Himachal Pradesh, Jammu & Kashmir, Ladakh, Chandigarh
//   2: Uttar Pradesh, Uttarakhand
//   3: Rajasthan, Gujarat, Daman & Diu, Dadra & Nagar Haveli
//   4: Chhattisgarh, Madhya Pradesh, Maharashtra, Goa
//   5: Andhra Pradesh, Karnataka, Telangana
//   6: Kerala, Tamil Nadu, Puducherry, Lakshadweep
//   7: Arunachal Pradesh, Assam, Manipur, Meghalaya, Mizoram, Nagaland,
//      Sikkim, Tripura, West Bengal, Andaman & Nicobar
//   8: Bihar, Jharkhand
//   9: Army Postal Service (APS) and Field Post Office (FPO) — out of scope
//
// We don't verify against state — we just confirm the first digit COULD match
// the named state. If it can't, we say no.
// ---------------------------------------------------------------------------

const STATE_TO_PIN_FIRST_DIGITS = {
  // North
  'delhi':              ['1'],
  'haryana':            ['1'],
  'punjab':             ['1'],
  'himachal pradesh':   ['1'],
  'jammu & kashmir':    ['1'], 'jammu and kashmir': ['1'], 'j&k': ['1'],
  'ladakh':             ['1'],
  'chandigarh':         ['1'],
  // North-Central
  'uttar pradesh':      ['2'],
  'uttarakhand':        ['2'],
  // West
  'rajasthan':          ['3'],
  'gujarat':            ['3'],
  'daman & diu':        ['3'], 'daman and diu': ['3'],
  'dadra & nagar haveli': ['3'], 'dadra and nagar haveli': ['3'],
  // Central / West
  'chhattisgarh':       ['4'],
  'madhya pradesh':     ['4'],
  'maharashtra':        ['4'],
  'goa':                ['4'],
  // South
  'andhra pradesh':     ['5'],
  'karnataka':          ['5'],
  'telangana':          ['5'],
  'kerala':             ['6'],
  'tamil nadu':         ['6'],
  'puducherry':         ['6'], 'pondicherry': ['6'],
  'lakshadweep':        ['6'],
  // East / North-East
  'arunachal pradesh':  ['7'],
  'assam':              ['7'],
  'manipur':            ['7'],
  'meghalaya':          ['7'],
  'mizoram':            ['7'],
  'nagaland':           ['7'],
  'sikkim':             ['7'],
  'tripura':            ['7'],
  'west bengal':        ['7'],
  'andaman & nicobar':  ['7'], 'andaman and nicobar islands': ['7'],
  // East / Bihar
  'bihar':              ['8'],
  'jharkhand':          ['8'],
  // Other
  'odisha':             ['7'], 'orissa': ['7'],  // 75x-77x specifically
};

export function isValidPIN(raw) {
  if (typeof raw !== 'string') return false;
  return /^[1-9][0-9]{5}$/.test(raw.trim());
}

// pinMatchesState(pin, state) — returns:
//   true   - format valid and first digit consistent with state
//   false  - format valid but first digit conflicts with state
//   null   - one or both unparseable; can't conclude either way
export function pinMatchesState(pin, state) {
  if (!isValidPIN(pin)) return null;
  if (typeof state !== 'string' || state.trim().length === 0) return null;
  const allowed = STATE_TO_PIN_FIRST_DIGITS[state.trim().toLowerCase()];
  if (!allowed) return null;  // unknown state — can't conclude
  const firstDigit = pin.trim()[0];
  return allowed.includes(firstDigit);
}

// ---------- Phone / email shallow checks -----------------------------------

export function isPlausiblePhone(s) {
  if (typeof s !== 'string') return false;
  const digits = s.replace(/\D/g, '');
  // Indian mobile (10) or landline with STD (10–11) or with +91 (12).
  return digits.length >= 10 && digits.length <= 12;
}

export function isPlausibleEmail(s) {
  if (typeof s !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

// ---------- assessConfidence --------------------------------------------------
//
// Walks the parsed insurer object and applies overrides on top of the LLM's
// self-rating. Returns a NEW field_confidences map without mutating the
// input (so the caller can diff old vs. new for "agent self-corrected"
// audit if we ever want it).
//
// Rules applied:
//   insurer.gstin           -> 'high' if isValidGSTIN, 'low' if format set but invalid
//   insurer.pin             -> 'high' if isValidPIN, 'low' if format invalid
//   insurer.city            -> 'high' if pinMatchesState===true (corroborating)
//   insurer.state           -> 'high' if pinMatchesState===true
//   insurer.email           -> 'high' if isPlausibleEmail, 'low' if invalid
//   insurer.phone           -> 'high' if isPlausiblePhone, 'low' if invalid
//   insurer.ownership_type  -> 'high' if in ALLOWED_OWNERSHIP_TYPES (already
//                              clamped in extractor.js, so this is belt+suspenders)
// ----------------------------------------------------------------------------

import { ALLOWED_OWNERSHIP_TYPES } from './extractor';

export function assessConfidence(insurer, existing = {}) {
  if (!insurer || typeof insurer !== 'object') return existing;

  const out = { ...existing };

  if (insurer.gstin != null) {
    out['insurer.gstin'] = isValidGSTIN(insurer.gstin) ? 'high' : 'low';
  }

  if (insurer.pin != null) {
    out['insurer.pin'] = isValidPIN(insurer.pin) ? 'high' : 'low';
  }

  if (insurer.email != null) {
    out['insurer.email'] = isPlausibleEmail(insurer.email) ? 'high' : 'low';
  }
  if (insurer.phone != null) {
    out['insurer.phone'] = isPlausiblePhone(insurer.phone) ? 'high' : 'low';
  }

  // city/state corroboration via PIN. Only promote, don't demote — a city
  // can be correct without a matching PIN (e.g. PIN missing or off by one).
  const pinState = pinMatchesState(insurer.pin, insurer.state);
  if (pinState === true) {
    out['insurer.state'] = 'high';
    if (insurer.city) out['insurer.city'] = 'high';
  } else if (pinState === false) {
    // Outright disagreement — demote both so the reviewer notices.
    out['insurer.pin'] = 'low';
    out['insurer.state'] = 'low';
  }

  if (
    insurer.ownership_type &&
    ALLOWED_OWNERSHIP_TYPES.includes(insurer.ownership_type)
  ) {
    out['insurer.ownership_type'] = 'high';
  }

  return out;
}

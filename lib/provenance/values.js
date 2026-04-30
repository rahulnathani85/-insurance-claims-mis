// =============================================================================
// lib/provenance/values.js
// =============================================================================
// Typed FieldValue handling — spec §4.
//
// Stored shape in claim_field_values.value (JSONB):
//   { kind: 'money',  amount: <integer paise>,  currency: 'INR' }
//   { kind: 'date',   value: 'YYYY-MM-DD' }
//   { kind: 'datetime', value: 'YYYY-MM-DDThh:mm:ssZ' }
//   { kind: 'string', value: '...' }
//   { kind: 'enum',   value: '...', enumType: '...' }
//   { kind: 'pin',    value: '6-digit' }
//   { kind: 'phone',  value: '+91...', e164: '+91...' }
//   { kind: 'email',  value: '...' }
//   { kind: 'gps',    lat: number, lng: number, accuracy_m?: number }
//   { kind: 'address', line: '...', city?: ..., state?: ..., pin?: ... }
//
// value_normalized is the canonical equality-friendly string projection:
//   money    → "<paise>"          e.g. "5000000" for ₹50,000
//   date     → "YYYY-MM-DD"
//   datetime → ISO string
//   string   → trimmed lowercase
//   enum     → "<enumType>:<value>"
//   pin      → "<value>"
//   phone    → "<e164>"
//   email    → "<lowercased>"
//   gps      → "<lat.toFixed(6)>,<lng.toFixed(6)>"
//   address  → join of non-empty parts, lowercased
// =============================================================================

export const VALUE_KINDS = [
  'money', 'date', 'datetime', 'string', 'enum',
  'pin', 'phone', 'email', 'gps', 'address',
];

// Build a FieldValue from caller-friendly inputs. Returns { value, normalized }.
// Throws on inputs that can't be coerced into the stated kind.
export function buildFieldValue(kind, input) {
  switch (kind) {
    case 'money': {
      // input may be: number rupees ("5000000"), string with commas/symbols
      // ("₹50,00,000"), or already-paise object { amount, currency }.
      if (input && typeof input === 'object' && 'amount' in input) {
        const amount = Math.round(Number(input.amount));
        if (!Number.isFinite(amount)) throw new Error('money.amount must be a finite number');
        const value = { kind: 'money', amount, currency: input.currency || 'INR' };
        return { value, normalized: String(amount) };
      }
      const num = parseRupees(input);
      if (num === null) throw new Error(`Cannot parse money: ${input}`);
      const paise = Math.round(num * 100);
      const value = { kind: 'money', amount: paise, currency: 'INR' };
      return { value, normalized: String(paise) };
    }
    case 'date': {
      const iso = parseDateOnly(input);
      if (!iso) throw new Error(`Cannot parse date: ${input}`);
      return { value: { kind: 'date', value: iso }, normalized: iso };
    }
    case 'datetime': {
      const iso = parseDateTime(input);
      if (!iso) throw new Error(`Cannot parse datetime: ${input}`);
      return { value: { kind: 'datetime', value: iso }, normalized: iso };
    }
    case 'string': {
      const s = input == null ? '' : String(input);
      return { value: { kind: 'string', value: s }, normalized: s.trim().toLowerCase() };
    }
    case 'enum': {
      if (!input || typeof input !== 'object' || !input.enumType || input.value === undefined) {
        throw new Error('enum requires { value, enumType }');
      }
      const enumType = String(input.enumType);
      const v = String(input.value);
      return {
        value: { kind: 'enum', value: v, enumType },
        normalized: `${enumType}:${v}`,
      };
    }
    case 'pin': {
      const s = String(input || '').replace(/\D/g, '');
      if (s.length !== 6) throw new Error('pin must be 6 digits');
      return { value: { kind: 'pin', value: s }, normalized: s };
    }
    case 'phone': {
      const e164 = toE164(input);
      if (!e164) throw new Error(`Cannot canonicalise phone: ${input}`);
      return { value: { kind: 'phone', value: e164, e164 }, normalized: e164 };
    }
    case 'email': {
      const e = String(input || '').trim().toLowerCase();
      if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        throw new Error(`Invalid email: ${input}`);
      }
      return { value: { kind: 'email', value: e }, normalized: e };
    }
    case 'gps': {
      if (!input || typeof input !== 'object') throw new Error('gps requires { lat, lng }');
      const lat = Number(input.lat);
      const lng = Number(input.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('gps.lat and gps.lng must be numbers');
      }
      const accuracy_m = input.accuracy_m !== undefined ? Number(input.accuracy_m) : undefined;
      const v = { kind: 'gps', lat, lng };
      if (Number.isFinite(accuracy_m)) v.accuracy_m = accuracy_m;
      return { value: v, normalized: `${lat.toFixed(6)},${lng.toFixed(6)}` };
    }
    case 'address': {
      if (!input || typeof input !== 'object' || !input.line) {
        throw new Error('address requires at least { line }');
      }
      const v = {
        kind: 'address',
        line: String(input.line).trim(),
      };
      if (input.city)  v.city  = String(input.city).trim();
      if (input.state) v.state = String(input.state).trim();
      if (input.pin)   v.pin   = String(input.pin).trim();
      const parts = [v.line, v.city, v.state, v.pin].filter(Boolean).map((s) => s.toLowerCase());
      return { value: v, normalized: parts.join(' | ') };
    }
    default:
      throw new Error(`Unknown FieldValue kind: ${kind}`);
  }
}

// Type-aware equality. Two values are equal iff same kind AND the typed
// comparison passes. Returns false for differing kinds — never throws.
export function valuesEqual(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'money':    return Number(a.amount) === Number(b.amount) && (a.currency || 'INR') === (b.currency || 'INR');
    case 'date':     return a.value === b.value;
    case 'datetime': return new Date(a.value).getTime() === new Date(b.value).getTime();
    case 'string':   return (a.value || '').trim().toLowerCase() === (b.value || '').trim().toLowerCase();
    case 'enum':     return a.value === b.value && a.enumType === b.enumType;
    case 'pin':      return a.value === b.value;
    case 'phone':    return (a.e164 || a.value) === (b.e164 || b.value);
    case 'email':    return (a.value || '').toLowerCase() === (b.value || '').toLowerCase();
    case 'gps': {
      // Equal if within ~10m (rounded coords match).
      return Number(a.lat).toFixed(4) === Number(b.lat).toFixed(4)
          && Number(a.lng).toFixed(4) === Number(b.lng).toFixed(4);
    }
    case 'address': {
      const norm = (v) => [v.line, v.city, v.state, v.pin].filter(Boolean).join(' | ').toLowerCase();
      return norm(a) === norm(b);
    }
    default: return false;
  }
}

// -----------------------------------------------------------------------------
// internal parsers
// -----------------------------------------------------------------------------

function parseRupees(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;
  // Strip currency symbols, spaces, commas, "Rs."/"₹"/"INR" prefix
  let s = input.trim()
    .replace(/^(rs\.?|inr|₹)\s*/i, '')
    .replace(/[,\s]/g, '');
  // Handle "lakhs" / "crores" suffix
  let multiplier = 1;
  if (/lakhs?$/i.test(s)) { multiplier = 1e5; s = s.replace(/lakhs?$/i, ''); }
  else if (/crores?$/i.test(s)) { multiplier = 1e7; s = s.replace(/crores?$/i, ''); }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n * multiplier;
}

function parseDateOnly(input) {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return iso(input).slice(0, 10);
  }
  if (typeof input !== 'string') return null;
  // Accept YYYY-MM-DD straight through
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Accept DD/MM/YYYY or DD-MM-YYYY
  const m2 = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(input);
  if (m2) {
    const dd = m2[1].padStart(2, '0');
    const mm = m2[2].padStart(2, '0');
    return `${m2[3]}-${mm}-${dd}`;
  }
  // Last resort: Date.parse
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return iso(d).slice(0, 10);
}

function parseDateTime(input) {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : iso(input);
  }
  if (typeof input === 'string') {
    const d = new Date(input);
    if (!Number.isNaN(d.getTime())) return iso(d);
  }
  return null;
}

function iso(d) {
  return d.toISOString();
}

function toE164(input) {
  if (input === null || input === undefined) return null;
  const raw = String(input).replace(/[^\d+]/g, '');
  if (!raw) return null;
  if (raw.startsWith('+')) return raw;
  // Default to +91 (India) for 10-digit numbers — matches the rest of the
  // codebase's local-numbers-are-Indian assumption.
  if (raw.length === 10) return `+91${raw}`;
  if (raw.length === 12 && raw.startsWith('91')) return `+${raw}`;
  return null;
}

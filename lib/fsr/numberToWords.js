// =============================================================================
// lib/fsr/numberToWords.js
// =============================================================================
// Indian-English number-to-words converter for FSR amount-in-words rendering.
//
// Production samples render currency amounts with the words spelled out:
//   "(Rupees Thirty Thousand Six Hundred and Four Only)"
//   "(Rupees Fifty Nine Thousand Six Hundred and Forty Eight Only)"
//
// We follow the Indian numbering system (lakh / crore) — NOT the
// short-scale (thousand / million / billion) — because the resulting
// reports are submitted to Indian PSU insurers and IRDAI.
//
// Edge cases:
//   - Zero               → "Zero"
//   - Negative           → prepended with "Minus"
//   - Decimals           → rounded to 2 dp; emits "<int> Rupees and <paise> Paise"
//   - Whole numbers      → no "Paise" tail
//   - NaN / undefined    → empty string (caller can decide what to render)
// =============================================================================

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
  'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

function under100(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? TENS[t] : `${TENS[t]} ${ONES[o]}`;
}

function under1000(n) {
  if (n < 100) return under100(n);
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (rest === 0) return `${ONES[h]} Hundred`;
  return `${ONES[h]} Hundred and ${under100(rest)}`;
}

// Indian system: ones (0-999), thousand (1k-99999), lakh (1L-99,99,999), crore (1Cr+)
function intToWords(num) {
  if (num === 0) return 'Zero';
  if (num < 0) return `Minus ${intToWords(-num)}`;

  const parts = [];

  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  if (crore) {
    parts.push(under100(crore) + ' Crore');
  }

  const lakh = Math.floor(num / 100000);
  num %= 100000;
  if (lakh) {
    parts.push(under100(lakh) + ' Lakh');
  }

  const thousand = Math.floor(num / 1000);
  num %= 1000;
  if (thousand) {
    parts.push(under100(thousand) + ' Thousand');
  }

  if (num) {
    parts.push(under1000(num));
  }

  return parts.join(' ');
}

// Convert a numeric (rupees + optional paise) into the FSR-style phrase
// "Rupees X Only" or "Rupees X and Y Paise Only".
export function rupeesInWords(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  // Round to 2 dp to get clean rupees + paise.
  const cents = Math.round(Math.abs(n) * 100);
  const rupees = Math.floor(cents / 100) * Math.sign(n || 1);
  const paise = cents % 100;
  const sign = n < 0 ? 'Minus ' : '';

  const rupeeWords = intToWords(Math.abs(rupees));
  if (paise === 0) {
    return `${sign}Rupees ${rupeeWords} Only`;
  }
  return `${sign}Rupees ${rupeeWords} and ${under100(paise)} Paise Only`;
}

// Convenience for non-currency contexts (e.g. quantities). Returns just the
// number in words, no "Rupees" / "Only" wrapping.
export function numberInWords(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return intToWords(Math.round(n));
}

// Test harness export
export const __internals = { ONES, TENS, intToWords, under100, under1000 };

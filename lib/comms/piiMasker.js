// ============================================================
// lib/comms/piiMasker.js
// ------------------------------------------------------------
// Strips Indian PII from prompt content before it leaves the
// process and reaches the AI provider. Wraps callAI() so the
// classifier never has to remember to mask each call.
//
// Patterns:
//   - PAN:     ABCDE1234F   (5 letters + 4 digits + 1 letter)
//   - Aadhaar: 12 digits, optionally split 4-4-4 by space/hyphen
//   - Mobile:  10 digits starting 6-9, with optional +91 / 91 / 0 prefix
//
// Mask: keep first + last char; replace middle with `*` (preserves
// length, keeps the redaction visually obvious in logs).
//   ABCDE1234F   -> A********F
//   1234 5678 9012 -> 1************2
//   +91 9876543210 -> +***********0
// ============================================================

import { callAI } from '@/lib/aiClient';

// PAN — strict 10-char identifier.
const PAN_RE = /\b[A-Z]{5}\d{4}[A-Z]\b/g;

// Aadhaar — 12 digits, no leading/trailing digits to avoid greedy matches
// inside longer numeric strings.
const AADHAAR_RE = /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g;

// Indian mobile — 10 digits starting 6-9, with optional country/local prefix.
// The negative lookbehind/lookahead keeps us out of longer digit strings.
const MOBILE_RE = /(?<!\d)(?:\+?91[\s-]?|0)?[6-9]\d{9}(?!\d)/g;

function mask(match) {
  if (match.length <= 2) return match;
  return match.charAt(0) + '*'.repeat(match.length - 2) + match.charAt(match.length - 1);
}

// Returns { text, redactions }.
export function maskPII(input) {
  if (!input || typeof input !== 'string') {
    return { text: input, redactions: 0 };
  }
  let text = input;
  let count = 0;

  // Order matters: PAN is most specific, Aadhaar before Mobile so that
  // a 12-digit Aadhaar isn't partially matched by the mobile regex.
  text = text.replace(PAN_RE, (m) => { count += 1; return mask(m); });
  text = text.replace(AADHAAR_RE, (m) => { count += 1; return mask(m); });
  text = text.replace(MOBILE_RE, (m) => { count += 1; return mask(m); });

  return { text, redactions: count };
}

// wrapCallAI — masks PII in systemPrompt + every messages[].content,
// then forwards to lib/aiClient.callAI(). Returns
//   { text, provider, redactions }
// where `redactions` is the total count across system + messages.
export async function wrapCallAI({ systemPrompt, messages, maxTokens }) {
  let totalRedactions = 0;

  const sys = maskPII(systemPrompt || '');
  totalRedactions += sys.redactions;

  const masked = (messages || []).map((m) => {
    const r = maskPII(m?.content || '');
    totalRedactions += r.redactions;
    return { ...m, content: r.text };
  });

  const result = await callAI({
    systemPrompt: sys.text,
    messages: masked,
    maxTokens,
  });
  return { ...result, redactions: totalRedactions };
}

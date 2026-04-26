// ============================================================
// lib/aiClients/ocrClient.js
// ------------------------------------------------------------
// OCR client used by lib/comms/attachmentReader (Stage 3c+).
//
// Provider selection:
//   - Default primary: 'mistral_ocr'
//   - Override per-call via { provider }
//   - Override globally via env OCR_PROVIDER (e.g., 'textract')
//
// Fallback:
//   - If primary throws and fallbackProviders has another entry,
//     it's tried. Default fallback chain is empty (one shot only)
//     because OCR failures are usually permanent (corrupt PDF,
//     unsupported format), not transient.
//
// Cost tracking:
//   - Every attempt writes to ai_call_log (scope='ocr').
//
// Returns text concatenated across pages. The triageExtractor
// then combines body_plain + ocr_text into the LLM prompt.
// ============================================================

import * as mistralOcr from './providers/mistralOcr';
import * as textract from './providers/textract';
import { recordAICall } from './aiCallLog';

const PROVIDERS = {
  mistral_ocr: mistralOcr,
  textract,
};

const DEFAULT_PRIMARY = 'mistral_ocr';
const DEFAULT_FALLBACKS = []; // OCR failures are usually permanent

// ------------------------------------------------------------
// extractText({ buffer, mimeType, filename, ...options })
//
// Returns: {
//   text:        OCR'd text, page-joined
//   provider:    'mistral_ocr' | 'textract'
//   model:       provider model id
//   pages:       page count
//   costInr:     INR cost estimate
//   latencyMs:
//   isFallback:
// }
// ------------------------------------------------------------
export async function extractText({
  buffer,
  mimeType,
  filename,
  // Provider selection
  provider,
  model,
  fallbackProviders,
  // Tracking
  messageId = null,
  attachmentId = null,
  triggeredBy = 'auto',
}) {
  if (!buffer || !buffer.length) {
    throw new Error('extractText: empty buffer');
  }

  const primary = (provider || process.env.OCR_PROVIDER || DEFAULT_PRIMARY).toLowerCase();
  const fbList = Array.isArray(fallbackProviders)
    ? fallbackProviders
    : (process.env.OCR_FALLBACK_PROVIDERS
        ? process.env.OCR_FALLBACK_PROVIDERS.split(',').map((s) => s.trim())
        : DEFAULT_FALLBACKS);

  const tryOrder = [primary, ...fbList.filter((p) => p && p !== primary)];

  let lastError = null;
  let lastErrorMsg = null;

  for (let i = 0; i < tryOrder.length; i++) {
    const name = tryOrder[i];
    const isFallback = i > 0;
    const impl = PROVIDERS[name];
    if (!impl || typeof impl.extract !== 'function') {
      lastErrorMsg = `unknown OCR provider: ${name}`;
      continue;
    }

    const startedAt = Date.now();
    try {
      const result = await impl.extract({
        buffer,
        mimeType,
        filename,
        model,
      });
      const latencyMs = Date.now() - startedAt;

      await recordAICall({
        scope: 'ocr',
        provider: name,
        model: result.model,
        messageId,
        attachmentId,
        triggeredBy,
        pages: result.pages,
        costInr: result.costInr,
        latencyMs,
        isFallback,
        errorMessage: lastErrorMsg,
      });

      return {
        text: result.text,
        provider: name,
        model: result.model,
        pages: result.pages ?? null,
        costInr: result.costInr ?? null,
        latencyMs,
        isFallback,
      };
    } catch (err) {
      const errMsg = err?.message || String(err);
      const latencyMs = Date.now() - startedAt;

      await recordAICall({
        scope: 'ocr',
        provider: name,
        model: model || PROVIDERS[name]?.meta?.defaultModel || null,
        messageId,
        attachmentId,
        triggeredBy,
        latencyMs,
        isFallback,
        errorMessage: errMsg,
      });

      lastError = err;
      lastErrorMsg = `${name}: ${errMsg}`;
      console.warn(`[ocrClient] ${name} failed:`, errMsg);
    }
  }

  throw lastError ||
    new Error(lastErrorMsg || 'No OCR provider available');
}

export function listProviders() {
  return Object.entries(PROVIDERS).map(([name, mod]) => ({
    name,
    defaultModel: mod?.meta?.defaultModel || null,
  }));
}

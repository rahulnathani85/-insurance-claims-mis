// ============================================================
// lib/aiClients/llmClient.js
// ------------------------------------------------------------
// LLM client used by the comms triage extractor (Stage 3+).
//
// Provider selection:
//   - Default primary: 'claude' (Sonnet 4.5/4.6)
//   - Override per-call via { provider }
//   - Override globally via env LLM_PROVIDER
//
// Fallback chain:
//   - If primary throws, the fallbackProviders list is tried in order
//   - First successful response wins
//   - If everything fails, the last error is rethrown
//
// Cost tracking:
//   - Every attempt (success or failure) writes to ai_call_log
//   - Records: provider, model, tokens_in/out, cost_inr, latency_ms,
//     is_fallback, error_message
//
// PII masking is NOT applied here — it's a comms-specific concern.
// Callers in the comms module wrap callLLM via lib/comms/piiMasker.
// ============================================================

import * as claude from './providers/claude';
import * as gemini from './providers/gemini';
import { recordAICall } from './aiCallLog';

const PROVIDERS = {
  claude,
  gemini,
};

const DEFAULT_PRIMARY = 'claude';
const DEFAULT_FALLBACKS = ['gemini'];

// ------------------------------------------------------------
// callLLM({ systemPrompt, messages, maxTokens, ...options })
//
// Returns: {
//   text:        the model output
//   provider:    which provider actually answered
//   model:       which model id
//   tokensIn:    input tokens (when provider returns it)
//   tokensOut:   output tokens (when provider returns it)
//   costInr:     INR cost estimate (when computable)
//   latencyMs:   wall-clock ms for the successful call
//   isFallback:  true if a fallback provider answered
// }
// ------------------------------------------------------------
export async function callLLM({
  systemPrompt,
  messages,
  maxTokens = 4096,
  // Provider selection
  provider,
  model,
  fallbackProviders,
  // Tracking metadata (passed through to ai_call_log)
  messageId = null,
  attachmentId = null,
  triggeredBy = 'auto',
}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('callLLM: messages must be a non-empty array');
  }

  const primary = (provider || process.env.LLM_PROVIDER || DEFAULT_PRIMARY).toLowerCase();
  const fbList = Array.isArray(fallbackProviders)
    ? fallbackProviders
    : (process.env.LLM_FALLBACK_PROVIDERS
        ? process.env.LLM_FALLBACK_PROVIDERS.split(',').map((s) => s.trim())
        : DEFAULT_FALLBACKS);

  const tryOrder = [primary, ...fbList.filter((p) => p && p !== primary)];

  let lastError = null;
  let lastErrorMsg = null;

  for (let i = 0; i < tryOrder.length; i++) {
    const name = tryOrder[i];
    const isFallback = i > 0;
    const impl = PROVIDERS[name];
    if (!impl || typeof impl.call !== 'function') {
      lastErrorMsg = `unknown LLM provider: ${name}`;
      continue;
    }

    const startedAt = Date.now();
    try {
      const result = await impl.call({
        systemPrompt,
        messages,
        maxTokens,
        model,
      });
      const latencyMs = Date.now() - startedAt;

      // Successful call — record + return.
      await recordAICall({
        scope: 'llm',
        provider: name,
        model: result.model,
        messageId,
        attachmentId,
        triggeredBy,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costInr: result.costInr,
        latencyMs,
        isFallback,
        errorMessage: lastErrorMsg, // surface why we fell back, if we did
      });

      return {
        text: result.text,
        provider: name,
        model: result.model,
        tokensIn: result.tokensIn ?? null,
        tokensOut: result.tokensOut ?? null,
        costInr: result.costInr ?? null,
        latencyMs,
        isFallback,
      };
    } catch (err) {
      const errMsg = err?.message || String(err);
      const latencyMs = Date.now() - startedAt;

      // Record the failure (so cost dashboard shows attempted providers)
      await recordAICall({
        scope: 'llm',
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
      console.warn(`[llmClient] ${name} failed:`, errMsg);
      // continue to next provider in tryOrder
    }
  }

  // Everything failed.
  throw lastError ||
    new Error(lastErrorMsg || 'No LLM provider available');
}

// Expose provider list for diagnostics (e.g. admin/health expansion)
export function listProviders() {
  return Object.entries(PROVIDERS).map(([name, mod]) => ({
    name,
    defaultModel: mod?.meta?.defaultModel || null,
  }));
}

// ============================================================
// lib/aiClients/aiCallLog.js
// ------------------------------------------------------------
// Best-effort writer for the ai_call_log table.
// Every OCR/LLM call goes through callLLM() / extractText() which
// invokes recordAICall() to persist provider/model/tokens/cost.
//
// On failure it console.warns and returns silently — never throws,
// because an audit-log outage must not break the actual extraction.
// ============================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function recordAICall({
  scope,                 // 'ocr' | 'llm'
  provider,              // 'claude' | 'gemini' | 'mistral_ocr' | 'textract'
  model = null,
  messageId = null,
  attachmentId = null,
  triggeredBy = 'auto',
  tokensIn = null,
  tokensOut = null,
  pages = null,
  costInr = null,
  latencyMs = null,
  isFallback = false,
  errorMessage = null,
}) {
  if (!scope || !provider) return;

  try {
    await supabaseAdmin.from('ai_call_log').insert([{
      scope,
      provider,
      model,
      message_id: messageId,
      attachment_id: attachmentId,
      triggered_by: triggeredBy,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      pages,
      cost_inr: costInr,
      latency_ms: latencyMs,
      is_fallback: isFallback,
      error_message: errorMessage,
    }]);
  } catch (err) {
    console.warn(
      '[aiCallLog] insert failed (non-fatal):',
      err?.message || err
    );
  }
}

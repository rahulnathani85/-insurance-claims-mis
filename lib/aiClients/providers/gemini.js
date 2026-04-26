// ============================================================
// lib/aiClients/providers/gemini.js
// ------------------------------------------------------------
// Google Gemini provider for the LLM client. Used as fallback
// when Claude (primary) fails, or when LLM_PROVIDER=gemini is
// explicitly set.
//
// Pricing reference (USD per 1M tokens, Gemini 2.0 Flash):
//   - input:  $0.10
//   - output: $0.40
// ~30x cheaper than Claude Sonnet on input. Worth keeping as the
// fallback path.
// ============================================================

const DEFAULT_MODEL = 'gemini-2.0-flash';
const USD_PER_M_INPUT_TOK = 0.10;
const USD_PER_M_OUTPUT_TOK = 0.40;

export async function call({ systemPrompt, messages, maxTokens = 4096, model }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const useModel = model || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${apiKey}`;

  // Map portable {role,content} → Gemini's {role,parts:[{text}]}
  // Note: Gemini uses 'model' instead of 'assistant'.
  const contents = (messages || []).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content || '' }],
  }));

  const body = {
    system_instruction: { parts: [{ text: systemPrompt || '' }] },
    contents,
    generationConfig: { maxOutputTokens: maxTokens },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Gemini API error ${res.status}: ${errText.substring(0, 300)}`
    );
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) {
    throw new Error('Gemini returned no text');
  }

  // Gemini's REST API returns usageMetadata when present.
  const usage = data?.usageMetadata || {};
  const tokensIn = usage.promptTokenCount ?? null;
  const tokensOut = usage.candidatesTokenCount ?? null;
  const costInr = estimateCostInr({ tokensIn, tokensOut });

  return {
    text,
    model: useModel,
    tokensIn,
    tokensOut,
    costInr,
  };
}

function estimateCostInr({ tokensIn, tokensOut }) {
  if (tokensIn == null && tokensOut == null) return null;
  const inrPerUsd = Number(process.env.LLM_INR_PER_USD || '83');
  const usdCost =
    ((tokensIn || 0) * USD_PER_M_INPUT_TOK +
      (tokensOut || 0) * USD_PER_M_OUTPUT_TOK) /
    1_000_000;
  return Number((usdCost * inrPerUsd).toFixed(6));
}

export const meta = {
  name: 'gemini',
  defaultModel: DEFAULT_MODEL,
  scopes: ['llm'],
};

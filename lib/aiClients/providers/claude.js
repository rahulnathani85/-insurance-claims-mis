// ============================================================
// lib/aiClients/providers/claude.js
// ------------------------------------------------------------
// Anthropic Claude provider for the LLM client.
//
// Default model: claude-sonnet-4-5-20250929 (Sonnet 4.6 era).
// Override via env LLM_MODEL or per-call `model` arg.
//
// Pricing reference (USD per 1M tokens, Sonnet 4.5/4.6 tier):
//   - input:  $3.00
//   - output: $15.00
// INR conversion is fixed at 83 INR/USD here for cost estimates;
// adjust LLM_INR_PER_USD env var if you want a different rate.
// ============================================================

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const USD_PER_M_INPUT_TOK = 3.0;
const USD_PER_M_OUTPUT_TOK = 15.0;

export async function call({ systemPrompt, messages, maxTokens = 4096, model }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  // Standard `await import` so Webpack discovers the package and
  // Vercel bundles it into the serverless function. The previous
  // `new Function('m', 'return import(m)')` trick evaded Webpack
  // (intentionally, for opt-in SDKs like AWS Textract) but for a
  // primary-path dependency that's listed in package.json, we want
  // it bundled.
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const useModel = model || process.env.LLM_MODEL || DEFAULT_MODEL;

  const response = await client.messages.create({
    model: useModel,
    max_tokens: maxTokens,
    system: systemPrompt || '',
    messages,
  });

  // Concatenate any text blocks (Claude 4.x can return multiple).
  const text = (response.content || [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');

  const usage = response.usage || {};
  const tokensIn = usage.input_tokens ?? null;
  const tokensOut = usage.output_tokens ?? null;
  const costInr = estimateCostInr({ tokensIn, tokensOut });

  return {
    text,
    model: response.model || useModel,
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
  name: 'claude',
  defaultModel: DEFAULT_MODEL,
  scopes: ['llm'],
};

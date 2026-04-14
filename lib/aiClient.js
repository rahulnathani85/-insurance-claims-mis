// Multi-provider AI client: Gemini Flash (primary) → Claude (fallback)
// v3 - Uses fetch() for Gemini REST API (no SDK dependency issues)

export async function callAI({ systemPrompt, messages, maxTokens = 4096 }) {
  const geminiKey = process.env.GEMINI_API_KEY || 'AIzaSyDF9i1g4bvg0GsgRo-0_L0_BjNITcVqznM';
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // Try Gemini first via REST API (no SDK needed)
  if (geminiKey) {
    try {
      const result = await callGeminiRest({ systemPrompt, messages, maxTokens, apiKey: geminiKey });
      return { text: result, provider: 'gemini' };
    } catch (err) {
      console.warn('Gemini failed:', err.message);
    }
  }

  // Fallback to Claude
  if (anthropicKey) {
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: anthropicKey });
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      });
      return { text: response.content[0].text, provider: 'claude' };
    } catch (err) {
      console.error('Claude also failed:', err.message);
    }
  }

  throw new Error('AI call failed. Check GEMINI_API_KEY and server logs.');
}

// Gemini via REST API — no SDK dependency, works everywhere
async function callGeminiRest({ systemPrompt, messages, maxTokens, apiKey }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  // Build contents array
  const contents = [];

  // Add conversation history
  for (const msg of messages) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { maxOutputTokens: maxTokens },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No text in Gemini response');
  return text;
}

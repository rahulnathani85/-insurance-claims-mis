// Multi-provider AI client: Gemini Flash (primary) → Claude (fallback)
// v2 - force fresh deployment to pick up env vars

// Call AI with automatic fallback: Gemini first, then Claude
export async function callAI({ systemPrompt, messages, maxTokens = 4096 }) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  console.log('[AI] Gemini key present:', !!geminiKey, '| Anthropic key present:', !!anthropicKey);

  // Try Gemini first (cheaper, faster)
  if (geminiKey) {
    try {
      const result = await callGemini({ systemPrompt, messages, maxTokens, apiKey: geminiKey });
      return { text: result, provider: 'gemini' };
    } catch (err) {
      console.warn('Gemini failed, falling back to Claude:', err.message);
    }
  }

  // Fallback to Claude
  if (anthropicKey) {
    try {
      const result = await callClaude({ systemPrompt, messages, maxTokens, apiKey: anthropicKey });
      return { text: result, provider: 'claude' };
    } catch (err) {
      console.error('Claude also failed:', err.message);
      throw new Error('Both AI providers failed. Gemini: ' + (geminiKey ? 'error' : 'no key') + ', Claude: ' + err.message);
    }
  }

  throw new Error('No AI provider configured. Add GEMINI_API_KEY or ANTHROPIC_API_KEY to environment variables.');
}

// Google Gemini Flash
async function callGemini({ systemPrompt, messages, maxTokens, apiKey }) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  });

  // Convert messages to Gemini format
  const geminiHistory = [];
  const lastMessage = messages[messages.length - 1];

  for (let i = 0; i < messages.length - 1; i++) {
    const msg = messages[i];
    geminiHistory.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }

  const chat = model.startChat({
    history: geminiHistory,
    generationConfig: { maxOutputTokens: maxTokens },
  });

  const result = await chat.sendMessage(lastMessage.content);
  return result.response.text();
}

// Anthropic Claude
async function callClaude({ systemPrompt, messages, maxTokens, apiKey }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  return response.content[0].text;
}

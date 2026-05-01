// =============================================================================
// lib/fsr/draftNarrativePrompt.js
// =============================================================================
// Builds the Claude prompt for drafting FSR narrative sections (cause of
// loss, observations, admissibility, recommendation).
//
// Lifted from nisla-ai-pack/supabase/functions/draft-narrative/index.ts —
// system + user prompt strings only. The actual API call goes through the
// portal's existing lib/aiClient.js (Gemini → Claude fallback router).
//
// Usage:
//   import { buildDraftNarrativePrompt } from '@/lib/fsr/draftNarrativePrompt';
//   import { callAI } from '@/lib/aiClient';
//
//   const { system, user } = buildDraftNarrativePrompt({ claimData, surveyorNotes });
//   const { text } = await callAI({
//     systemPrompt: system,
//     messages: [{ role: 'user', content: user }],
//     maxTokens: 1500,
//   });
//   const narrative = parseNarrativeJson(text);  // exported below
// =============================================================================

const SYSTEM_PROMPT = `You are an experienced IRDAI-licensed Insurance Surveyor & Loss Assessor at NISLA / ACUERE, an established surveyor firm. You draft Final Survey Report (FSR) narrative sections in the formal, factual style expected by Indian PSU insurers (New India, Oriental, National, United India) and major private insurers.

Style rules:
- Third person, past tense, formal English. Refer to yourself as "the undersigned" or "we".
- Be factual. Never embellish or speculate. Use only facts in the structured claim data + the surveyor's notes.
- Use full insurer name and policy number where relevant.
- Each section should be 2-5 sentences. Concise, not flowery.
- Do NOT invent figures, parties, or dates. If something is missing in the input, write a placeholder like "[to be confirmed]".

Output ONLY a JSON object with these four keys, each a plain string (no markdown):
{
  "causeOfLoss": "...",
  "surveyObservations": "...",
  "policyAdmissibility": "...",
  "recommendation": "..."
}`;

export function buildDraftNarrativePrompt({ claimData, surveyorNotes = '' }) {
  if (!claimData || typeof claimData !== 'object') {
    throw new Error('buildDraftNarrativePrompt: claimData is required');
  }
  const user =
    `Structured claim JSON:\n${JSON.stringify(claimData, null, 2)}\n\n` +
    `Surveyor's rough notes (may be empty):\n${surveyorNotes || '(none)'}\n\n` +
    `Draft the four narrative sections now. Output JSON only.`;

  return { system: SYSTEM_PROMPT, user };
}

// Defensive parser — Claude sometimes wraps JSON in markdown fences.
// Falls back to an empty narrative skeleton if the response is unparseable
// so the caller never hard-fails on a slightly-malformed reply.
export function parseNarrativeJson(text) {
  if (typeof text !== 'string') return emptyNarrative();
  const stripped = text.replace(/```json|```/g, '').trim();
  try {
    const obj = JSON.parse(stripped);
    return {
      causeOfLoss:        toStr(obj.causeOfLoss),
      surveyObservations: toStr(obj.surveyObservations),
      policyAdmissibility: toStr(obj.policyAdmissibility),
      recommendation:     toStr(obj.recommendation),
    };
  } catch {
    return emptyNarrative();
  }
}

function toStr(v) {
  if (typeof v !== 'string') return '';
  return v.trim();
}

function emptyNarrative() {
  return {
    causeOfLoss: '',
    surveyObservations: '',
    policyAdmissibility: '',
    recommendation: '',
  };
}

export { SYSTEM_PROMPT as DRAFT_NARRATIVE_SYSTEM_PROMPT };

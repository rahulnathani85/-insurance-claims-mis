// =============================================================================
// lib/fsr/chatPrompt.js
// =============================================================================
// Per-claim conversational copilot. Lifted from
// nisla-ai-pack/supabase/functions/claim-chat/index.ts (system + context
// builder + parser). The actual AI call goes through lib/aiClient.js.
//
// The contract: surveyor sends a message; we package full claim context
// (claim row + provenance + narrative drafts + open issues + photos) into a
// system prompt; Claude returns JSON with `reply` (plaintext) and
// `proposedChanges[]` (structured edits the surveyor accepts/rejects).
//
// Schema for proposedChanges items — STRICT:
//   {
//     type:         'field' | 'narrative' | 'annexure' | 'computation',
//     path?:        '<dotted path, only when type=field>',
//     section?:     '<causeOfLoss | surveyObservations | policyAdmissibility | recommendation>',
//     currentValue: <existing value or null>,
//     newValue:     <proposed value>,
//     reason:       '<one-line justification visible to surveyor>',
//   }
// =============================================================================

const SYSTEM_PROMPT_BASE = `You are a senior IRDAI-licensed Insurance Surveyor & Loss Assessor at NISLA / ACUERE, acting as an AI co-pilot to a working surveyor preparing an Insurance Surveyor's Report.

Your role:
1. Answer the surveyor's questions about the claim, policy interpretation, IRDAI compliance, ICC clauses, computation methodology, and PSU insurer expectations. Be precise and cite policy/regulation when relevant.
2. When the surveyor asks for changes to the report ("rephrase", "add a paragraph", "make this more formal", "change the gross loss to X"), propose those changes as structured edits — never silently apply them.
3. Proactively flag quality issues: missing fields, weak language, computation mismatches, exclusion risks, admissibility gaps.
4. Use the classified site photographs in the context block as evidence. When drafting observations or cause-of-loss text, reference what the photos show. If photos carry FLAGS (tampering, pre-existing damage, unclear evidence, mismatch), call them out — they materially affect admissibility.
5. Stay factual. Never invent figures, dates, parties, or events not present in the claim data or photo observations. If a needed fact is missing, say so and ask the surveyor to provide it.

Output format — STRICTLY follow this JSON schema. No prose outside the JSON.

{
  "reply": "<your conversational reply to the surveyor, in plain text. May reference proposed changes by number.>",
  "proposedChanges": [
    {
      "type": "field" | "narrative" | "annexure" | "computation",
      "path": "<dotted path, only when type=field>",
      "section": "<causeOfLoss | surveyObservations | policyAdmissibility | recommendation, only when type=narrative>",
      "currentValue": <existing value or null>,
      "newValue": <proposed value>,
      "reason": "<one-line justification visible to surveyor>"
    }
  ]
}

Rules for proposedChanges:
- Only include changes the surveyor has clearly asked for, OR critical issues you've identified that materially affect the report's correctness.
- For type=field: use exact dotted paths from the schema (e.g. "marine.causeOfLoss", "computation.netAdjustedLoss", "warranty.failure.rootCause").
- For type=narrative: use the four standard sections only.
- Keep newValue concise and in PSU-style formal English for narrative sections.
- If no changes are needed, return an empty array. Conversational answers without changes are fine.`;

// -----------------------------------------------------------------------------
// buildSystemPrompt
// -----------------------------------------------------------------------------
// Combines the base prompt with a per-claim context block. The context
// block summarises the claim row, the merged provenance overlay, the
// narrative drafts, open issues, and classified photos so Claude has
// everything it needs in one shot.
// -----------------------------------------------------------------------------
export function buildClaimChatPrompt({ context = 'FSR', claim, mergedFields, narrative, issues = [], photos = [] }) {
  if (!claim) throw new Error('buildClaimChatPrompt: claim is required');

  const reportLabel = context === 'FSR' ? 'Final Survey Report' : 'Interim Liability Advice (ILA)';
  const contextBlock = buildContextBlock({ claim, mergedFields, narrative, issues, photos });
  const system = `${SYSTEM_PROMPT_BASE}\n\nReport context: ${context} (${reportLabel})\n\n${contextBlock}`;
  return { system };
}

function buildContextBlock({ claim, mergedFields, narrative, issues, photos }) {
  // Group photos by category for compact representation
  const photosByCat = {};
  for (const p of photos) {
    const k = p.category ?? 'UNCLASSIFIED';
    (photosByCat[k] = photosByCat[k] || []).push(p);
  }
  const photoSummary = Object.entries(photosByCat).length
    ? Object.entries(photosByCat).map(([cat, list]) =>
        `  ${cat} (${list.length}):\n` +
        list.map((p) => `    - ${p.filename}: ${p.observations}${p.flags?.length ? ` [FLAGS: ${p.flags.join(', ')}]` : ''}`).join('\n')
      ).join('\n')
    : 'No photos uploaded yet.';

  return [
    `CLAIM CONTEXT (read-only reference):`,
    `Ref / Claim no.: ${claim.ref_number || ''} / ${claim.claim_number || ''}`,
    `LOB: ${claim.lob || ''} (${claim.lob_subcategory || ''})`,
    `Status: ${claim.status || ''}  Phase: ${claim.phase || ''}`,
    `Insurer: ${claim.insurer_name || ''}`,
    `Insured: ${claim.insured_name || ''}`,
    `Policy: ${claim.policy_number || ''}`,
    `Date of loss: ${claim.date_loss || ''}`,
    `Loss location: ${claim.loss_location || ''}`,
    mergedFields ? `Merged provenance overlay (latest values + sources):\n${JSON.stringify(mergedFields, null, 2)}` : '',
    narrative ? `Current narrative drafts:\n  causeOfLoss: ${narrative.causeOfLoss || ''}\n  surveyObservations: ${narrative.surveyObservations || ''}\n  policyAdmissibility: ${narrative.policyAdmissibility || ''}\n  recommendation: ${narrative.recommendation || ''}` : 'Narrative not drafted yet.',
    issues.length ? `Open issues:\n${issues.map((i) => `  [${i.severity}] ${i.code} (${i.field}): ${i.message}`).join('\n')}` : 'No open issues.',
    `Classified site photographs:\n${photoSummary}`,
  ].filter(Boolean).join('\n\n');
}

// -----------------------------------------------------------------------------
// parseChatJson — defensive parser for Claude's reply
// -----------------------------------------------------------------------------
export function parseChatJson(text) {
  if (typeof text !== 'string') return { reply: '', proposedChanges: [] };
  const stripped = text.replace(/```json|```/g, '').trim();
  try {
    const obj = JSON.parse(stripped);
    return {
      reply: typeof obj.reply === 'string' ? obj.reply : String(obj.reply ?? ''),
      proposedChanges: Array.isArray(obj.proposedChanges) ? obj.proposedChanges : [],
    };
  } catch {
    // Treat raw text as the reply with no proposed changes — better than
    // hard-failing if Claude slips out of the JSON contract.
    return { reply: text, proposedChanges: [] };
  }
}

export { SYSTEM_PROMPT_BASE as CLAIM_CHAT_SYSTEM_PROMPT };

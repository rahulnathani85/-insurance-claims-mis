// ============================================================
// lib/comms/replyGenerator.js
// ------------------------------------------------------------
// Generates an AI draft reply for a triaged inbox message and
// persists it to email_drafts.
//
// Called by the executor's draft_reply action handler.
// ============================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { wrapCallLLM } from './piiMasker';
import { buildReplyPrompt, parseReplyJson } from './prompts/replyPrompt';
import { captureError } from '@/lib/observability';

export async function generateReplyDraft({
  message,
  tag,
  extractedData,
  claim,
  triggeredBy = 'auto',
  surveyorName = null,
}) {
  if (!message?.id) throw new Error('message.id required');
  if (!message.from_address) throw new Error('message.from_address required (cannot reply without To)');

  const { systemPrompt, userMessage } = buildReplyPrompt({
    message, tag, extractedData, claim, surveyorName,
  });

  let llmResult;
  try {
    llmResult = await wrapCallLLM({
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 800,
      messageId: message.id,
      triggeredBy,
    });
  } catch (err) {
    captureError(err, {
      area: 'comms-reply-generator',
      stage: 'llm-call',
      message_id: message.id,
      tag,
    });
    throw err;
  }

  let parsed;
  try {
    parsed = parseReplyJson(llmResult.text);
  } catch (err) {
    captureError(err, {
      area: 'comms-reply-generator',
      stage: 'parse',
      message_id: message.id,
      llm_text_sample: (llmResult.text || '').slice(0, 500),
    });
    throw err;
  }

  // Persist draft
  const { data: draft, error: dbErr } = await supabaseAdmin
    .from('email_drafts')
    .insert([{
      message_id: message.id,
      claim_id: claim?.id || null,
      to_address: message.from_address,
      subject: parsed.subject,
      body: parsed.body,
      generated_by: 'auto',
      llm_provider: llmResult.provider || null,
      llm_model: llmResult.model || null,
      llm_tokens_in: llmResult.tokensIn || null,
      llm_tokens_out: llmResult.tokensOut || null,
      llm_cost_inr: llmResult.costInr || null,
      status: 'draft',
    }])
    .select()
    .single();

  if (dbErr) {
    captureError(new Error(dbErr.message), {
      area: 'comms-reply-generator',
      stage: 'db-insert',
      message_id: message.id,
    });
    throw new Error(`email_drafts insert failed: ${dbErr.message}`);
  }

  return {
    draft_id: draft.id,
    subject: parsed.subject,
    body_chars: parsed.body.length,
    provider: llmResult.provider,
    cost_inr: llmResult.costInr,
  };
}

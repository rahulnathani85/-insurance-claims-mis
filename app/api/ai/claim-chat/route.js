// =============================================================================
// /api/ai/claim-chat
// =============================================================================
// Slice 7 — per-claim AI co-pilot.
//
// GET    ?claim_id=<id>&limit=<n>
//        Returns the last N (default 50) chat messages for a claim,
//        oldest-first. The UI hydrates the conversation panel with this.
//
// POST   { claim_id, message, user_email?, user_name?, history? }
//        1. Persists the user's new message.
//        2. Loads claim context (claim row, latest narrative_jsonb,
//           open issues, classified site_visit_photos if available).
//        3. Loads recent history (default 12 messages).
//        4. Calls Claude/Gemini via lib/aiClient with the
//           buildClaimChatPrompt system prompt + the conversation.
//        5. Parses { reply, proposedChanges } from the model output.
//        6. Persists the assistant reply with the proposedChanges
//           attached.
//        7. Returns both messages so the UI can append them.
//
// Errors:
//   400 bad request, 404 claim not found, 500 AI failure.
//
// Note on photo context: site_visit_photos doesn't exist yet (Slice 8
// adds it). We try the table and silently fall back to an empty list
// if it isn't there — keeps the chat feature usable today and lights
// up automatically once Slice 8 lands.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { callAI } from '@/lib/aiClient';
import { buildClaimChatPrompt, parseChatJson } from '@/lib/fsr';
import { captureError } from '@/lib/observability';
import { requireSurveyorRequest } from '@/lib/auth/insurer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ---- GET — chat history ---------------------------------------------------
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claimId = searchParams.get('claim_id');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200);

  if (!claimId) {
    return NextResponse.json({ error: 'claim_id is required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('claim_chat_messages')
    .select('*')
    .eq('claim_id', claimId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Reverse so the UI gets oldest-first.
  return NextResponse.json((data || []).reverse());
}

// ---- POST — send a message + get an AI reply ------------------------------
export async function POST(request) {
  // Phase 2 mutation guard
  try {
    await requireSurveyorRequest(request);
  } catch (e) {
    if (e?.code === 'INSURER_FORBIDDEN') {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    throw e;
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const claimId = body?.claim_id;
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const historyLimit = Math.min(parseInt(body?.history || '12', 10) || 12, 50);

  if (!claimId) return NextResponse.json({ error: 'claim_id is required' }, { status: 400 });
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 });

  // ---- Load claim ----
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from('claims').select('*').eq('id', claimId).single();
  if (claimErr || !claim) {
    return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  }

  // ---- Persist the user's message FIRST ----
  // We do this before the AI call so the message survives even if
  // Claude/Gemini fails. The UI re-reads via GET if POST 500s.
  let userMessage;
  try {
    const { data, error } = await supabaseAdmin
      .from('claim_chat_messages')
      .insert([{
        claim_id: claimId,
        role: 'user',
        user_email: body?.user_email || null,
        user_name: body?.user_name || null,
        content: message,
      }])
      .select()
      .single();
    if (error) throw error;
    userMessage = data;
  } catch (e) {
    captureError(e, { area: 'claim-chat-persist-user', claim_id: claimId });
    return NextResponse.json({ error: 'Could not save your message: ' + e.message }, { status: 500 });
  }

  // ---- Load supporting context in parallel ----
  let mergedFields = null;
  let narrative = null;
  let issues = [];
  let photos = [];
  let recentHistory = [];

  try {
    const [draftResult, issuesResult, photosResult, historyResult] = await Promise.all([
      supabaseAdmin
        .from('claim_fsr_drafts')
        .select('narrative_jsonb')
        .eq('claim_id', claimId)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('claim_issues')
        .select('severity, code, field, message')
        .eq('claim_id', claimId)
        .eq('status', 'open'),
      // site_visit_photos may not exist yet (Slice 8). Catch + fall back.
      loadPhotosTolerantly(claimId),
      supabaseAdmin
        .from('claim_chat_messages')
        .select('id, role, content, proposed_changes, created_at')
        .eq('claim_id', claimId)
        .order('created_at', { ascending: false })
        .limit(historyLimit + 1),  // +1 because we just inserted the user message
    ]);

    narrative = draftResult.data?.narrative_jsonb || null;
    issues = issuesResult.data || [];
    photos = photosResult || [];
    recentHistory = (historyResult.data || []).slice().reverse();  // oldest-first

    // Surface the latest claim columns as merged fields for the prompt.
    // (Slice 7's chat sees the claim row; Phase 2 can layer in
    // claim_field_values via lib/provenance/read for full
    // source attribution.)
    mergedFields = {
      ref_number: claim.ref_number,
      claim_number: claim.claim_number,
      insurer_name: claim.insurer_name,
      insured_name: claim.insured_name,
      policy_number: claim.policy_number,
      lob: claim.lob,
      lob_subcategory: claim.lob_subcategory,
      date_loss: claim.date_loss,
      date_of_intimation: claim.date_of_intimation,
      loss_location: claim.loss_location,
      sum_insured: claim.sum_insured,
      gross_loss: claim.gross_loss,
    };
  } catch (e) {
    // Non-fatal — chat works with partial context. Log and continue.
    captureError(e, { area: 'claim-chat-context', claim_id: claimId });
  }

  // ---- Build prompt ----
  let prompt;
  try {
    prompt = buildClaimChatPrompt({
      context: 'FSR',
      claim,
      mergedFields,
      narrative: narrative
        ? {
            // Map portal narrative_jsonb keys to the chat prompt's vocabulary.
            // The chat prompt uses the AI-pack 4-section names, so we
            // expose both flavours so the model sees whichever is filled.
            causeOfLoss: narrative.cause_of_loss || narrative.causeOfLoss || '',
            surveyObservations: narrative.observations || narrative.surveyObservations || '',
            policyAdmissibility: narrative.policy_admissibility || narrative.policyAdmissibility || '',
            recommendation: narrative.recommendation || '',
          }
        : null,
      issues,
      photos,
    });
  } catch (e) {
    captureError(e, { area: 'claim-chat-build-prompt', claim_id: claimId });
    return NextResponse.json({ error: 'prompt build failed: ' + e.message }, { status: 500 });
  }

  // ---- Build the messages array for Claude/Gemini ----
  const messages = [];
  for (const m of recentHistory) {
    if (m.id === userMessage.id) continue;  // already in the prompt as the current user turn
    messages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.role === 'assistant' && m.proposed_changes?.length
        ? JSON.stringify({ reply: m.content, proposedChanges: m.proposed_changes })
        : m.content,
    });
  }
  messages.push({ role: 'user', content: message });

  // ---- Call AI ----
  let aiResult;
  try {
    aiResult = await callAI({
      systemPrompt: prompt.system,
      messages,
      maxTokens: 2500,
    });
  } catch (e) {
    captureError(e, { area: 'claim-chat-call-ai', claim_id: claimId });
    return NextResponse.json({
      ok: false,
      user_message: userMessage,
      error: 'AI provider failed: ' + e.message,
    }, { status: 500 });
  }

  const parsed = parseChatJson(aiResult.text);

  // ---- Persist assistant reply ----
  let assistantMessage;
  try {
    const { data, error } = await supabaseAdmin
      .from('claim_chat_messages')
      .insert([{
        claim_id: claimId,
        role: 'assistant',
        content: parsed.reply,
        proposed_changes: parsed.proposedChanges?.length ? parsed.proposedChanges : null,
        in_reply_to: userMessage.id,
        ai_provider: aiResult.provider,
      }])
      .select()
      .single();
    if (error) throw error;
    assistantMessage = data;
  } catch (e) {
    captureError(e, { area: 'claim-chat-persist-assistant', claim_id: claimId });
    return NextResponse.json({
      ok: false,
      user_message: userMessage,
      error: 'Could not save assistant reply: ' + e.message,
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    user_message: userMessage,
    assistant_message: assistantMessage,
    provider: aiResult.provider,
  });
}

// -----------------------------------------------------------------------------
// loadPhotosTolerantly — query site_visit_photos for classified photos.
// Returns rows shaped for buildClaimChatPrompt (filename, category,
// observations, flags). The actual column names are file_name +
// ai_observations + ai_confidence; we alias them in the response so
// the prompt builder works against a single shape.
//
// If the AI-classification columns don't exist yet (pre-Slice 8/9
// migration), the query falls through with an error and we return [].
// -----------------------------------------------------------------------------
async function loadPhotosTolerantly(claimId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('site_visit_photos')
      .select('id, file_name, category, ai_observations, flags, ai_confidence')
      .eq('claim_id', claimId)
      .eq('classification_status', 'classified');
    if (error) return [];
    return (data || []).map((p) => ({
      id: p.id,
      filename: p.file_name,
      category: p.category,
      observations: p.ai_observations,
      flags: p.flags,
      confidence: p.ai_confidence,
    }));
  } catch {
    return [];
  }
}

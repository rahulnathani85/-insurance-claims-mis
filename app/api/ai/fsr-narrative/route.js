// =============================================================================
// /api/ai/fsr-narrative
// =============================================================================
// Slice 6 — focused per-section AI drafting endpoint. Powers the ✨ AI
// button next to each narrative textarea on the claim-detail FSR panel.
//
// Two modes, picked by the body shape:
//
//   1. SINGLE-SECTION (typical use — UI button)
//      POST /api/ai/fsr-narrative
//      Body:
//        {
//          claim_id:        BIGINT  (required)
//          section:         string  (required — narrative.* key, e.g.
//                                    'situation_of_loss', 'observations',
//                                    'person_contacted')
//          surveyor_notes?: string  (optional — extra context the
//                                    surveyor wants the AI to use)
//        }
//      Resp:
//        {
//          ok:        true,
//          section:   'situation_of_loss',
//          draft:     '<plain-text content>',
//          provider:  'gemini' | 'claude',
//          field_label: 'Situation of loss'
//        }
//
//   2. ALL-FOUR (bootstrap mode, slower — drafts the AI-pack's four
//      standard sections in one call). Triggered when section is omitted.
//      POST /api/ai/fsr-narrative
//      Body:
//        {
//          claim_id:        BIGINT
//          surveyor_notes?: string
//        }
//      Resp:
//        {
//          ok:        true,
//          narrative: {
//            causeOfLoss:        '...',
//            surveyObservations: '...',
//            policyAdmissibility:'...',
//            recommendation:     '...'
//          },
//          provider:  'gemini' | 'claude'
//        }
//
// Errors:
//   400  bad request  (missing claim_id, etc.)
//   404  claim not found
//   500  AI provider failure / unexpected
//
// Caller should write the returned draft into claim_fsr_drafts.narrative_jsonb
// via the existing /api/fsr-drafts/render flow (the FSR panel does this
// automatically — accepting the draft triggers a re-render).
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { callAI } from '@/lib/aiClient';
import {
  buildSectionDraftPrompt,
  parseSectionDraft,
  buildDraftNarrativePrompt,
  parseNarrativeJson,
} from '@/lib/fsr';
import { captureError } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const claimId = body?.claim_id;
  if (!claimId) {
    return NextResponse.json({ error: 'claim_id is required' }, { status: 400 });
  }

  const section = typeof body?.section === 'string' ? body.section.trim() : '';
  const surveyorNotes = typeof body?.surveyor_notes === 'string' ? body.surveyor_notes : '';

  // ---- Load claim + latest ILA + currently-saved narrative ----
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from('claims')
    .select('*')
    .eq('id', claimId)
    .single();
  if (claimErr || !claim) {
    return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  }

  // Latest ILA submission's draft (preliminary_view + admissibility)
  let ila = null;
  try {
    const { data: lastSubmission } = await supabaseAdmin
      .from('ila_submissions')
      .select('draft_id')
      .eq('claim_id', claimId)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastSubmission?.draft_id) {
      const { data: draft } = await supabaseAdmin
        .from('ila_drafts')
        .select('preliminary_view, admissibility_opinion, admissibility_reasoning')
        .eq('id', lastSubmission.draft_id)
        .maybeSingle();
      ila = draft || null;
    }
  } catch (e) {
    // Non-fatal — ILA may not exist yet for early-stage claims
    captureError(e, { area: 'ai-fsr-narrative-ila', claim_id: claimId });
  }

  // Current narrative_jsonb so the prompt can reference what's already filled
  let currentNarrative = {};
  try {
    const { data: latestDraft } = await supabaseAdmin
      .from('claim_fsr_drafts')
      .select('narrative_jsonb')
      .eq('claim_id', claimId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    currentNarrative = latestDraft?.narrative_jsonb || {};
  } catch (e) {
    captureError(e, { area: 'ai-fsr-narrative-current', claim_id: claimId });
  }

  // ---- Mode 1: single-section drafting ----
  if (section) {
    let prompt;
    try {
      prompt = buildSectionDraftPrompt({
        sectionKey: section,
        lob: claim.lob,
        claim,
        currentNarrative,
        surveyorNotes,
        ila,
      });
    } catch (e) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    let aiResult;
    try {
      aiResult = await callAI({
        systemPrompt: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        maxTokens: 1200,
      });
    } catch (e) {
      captureError(e, { area: 'ai-fsr-narrative-call', claim_id: claimId, section });
      return NextResponse.json({ error: 'AI provider failed: ' + e.message }, { status: 500 });
    }

    // Best-effort log to ai_call_log so we can track usage/cost
    logAiCall({ claimId, kind: 'narrative_section', section, provider: aiResult.provider, ok: true })
      .catch(() => {});

    return NextResponse.json({
      ok: true,
      section,
      draft: parseSectionDraft(aiResult.text),
      provider: aiResult.provider,
      field_label: prompt.fieldLabel,
    });
  }

  // ---- Mode 2: bootstrap all 4 standard sections in one call ----
  let prompt;
  try {
    prompt = buildDraftNarrativePrompt({
      claimData: { claim, ila, currentNarrative },
      surveyorNotes,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  let aiResult;
  try {
    aiResult = await callAI({
      systemPrompt: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      maxTokens: 2000,
    });
  } catch (e) {
    captureError(e, { area: 'ai-fsr-narrative-bootstrap', claim_id: claimId });
    return NextResponse.json({ error: 'AI provider failed: ' + e.message }, { status: 500 });
  }

  const narrative = parseNarrativeJson(aiResult.text);

  logAiCall({ claimId, kind: 'narrative_bootstrap', provider: aiResult.provider, ok: true })
    .catch(() => {});

  return NextResponse.json({
    ok: true,
    narrative,
    provider: aiResult.provider,
  });
}

// -----------------------------------------------------------------------------
// logAiCall — best-effort write to ai_call_log. Schema is tolerant; we
// only set the columns we know exist universally. Other columns get
// their defaults.
// -----------------------------------------------------------------------------
async function logAiCall({ claimId, kind, section = null, provider, ok }) {
  try {
    await supabaseAdmin.from('ai_call_log').insert([{
      claim_id: claimId,
      route: '/api/ai/fsr-narrative',
      kind,
      section,
      provider,
      success: ok,
    }]);
  } catch {
    // ai_call_log shape varies — non-fatal if a column is absent.
  }
}

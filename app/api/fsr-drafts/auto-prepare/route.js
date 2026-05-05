// =============================================================================
// /api/fsr-drafts/auto-prepare
// =============================================================================
// "Prepare FSR with AI" — manual button on the FSR Draft page.
//
// Workflow:
//   1. Surveyor clicks the button.
//   2. This endpoint loads everything the portal already has for the claim:
//      claim row, lifecycle template (resolved to fsr_template_name),
//      claim_documents (OCR'd text), intimation email body, loss sheet, ILA.
//   3. Builds a focused prompt scoped to the resolved template's narrative
//      schema (from lib/fsr/narrativeFields.js, the same source the form
//      uses — they cannot drift).
//   4. Calls the LLM, parses JSON, merges into existing narrative_jsonb
//      (NEVER overwriting fields the surveyor already typed).
//   5. Persists the merged narrative on the latest claim_fsr_drafts row,
//      re-renders the body_html, audit-logs the action.
//   6. Returns { filled, skipped, dropped, llm_meta, draft_id } so the UI
//      can show a toast and re-load the form.
//
// Errors:
//   400  bad request
//   404  claim not found
//   409  lifecycle not initialised / template missing fsr_template_name
//        (surfaced by lib/fsr/draft.js#resolveFsrTemplateName)
//   502  LLM call or JSON parse failed
//   500  unexpected
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireSurveyorRequest } from '@/lib/auth/insurer';
import { callLLM } from '@/lib/aiClients';
import { captureError } from '@/lib/observability';
import {
  loadFsrContext,
  buildContext,
  substitute,
  sanitiseDraftPayload,
} from '@/lib/fsr';
import { fieldsForLob } from '@/lib/fsr/narrativeFields';
import { readClaimDocuments } from '@/lib/comms/claimDocumentReader';
import {
  buildAutoPreparePrompt,
  parseAutoPrepareJson,
  mergeIntoNarrative,
} from '@/lib/fsr/narrativeAutoPreparePrompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min: covers OCR cache miss + LLM call

export async function POST(request) {
  // ---- Auth gate ----------------------------------------------------------
  try {
    await requireSurveyorRequest(request);
  } catch (e) {
    if (e?.code === 'INSURER_FORBIDDEN') {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    throw e;
  }

  // ---- Parse body ---------------------------------------------------------
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const claimId = body?.claim_id;
  if (!claimId) {
    return NextResponse.json({ error: 'claim_id is required' }, { status: 400 });
  }
  const userEmail = body?.user_email || request.headers.get('x-app-user-email') || null;

  // ---- Load context via the existing FSR resolver -------------------------
  // Surfaces 409 with code='LIFECYCLE_NOT_INITIALIZED' or
  // 'FSR_TEMPLATE_NOT_CONFIGURED' for post-cutoff claims that aren't ready,
  // matching the UX of /api/fsr-drafts/render.
  let ctx;
  try {
    ctx = await loadFsrContext(supabaseAdmin, { claimId });
  } catch (e) {
    if (/not found/i.test(e.message)) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    if (e?.statusCode === 409 && e?.code) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 409 });
    }
    captureError(e, { area: 'fsr-auto-prepare-load', claim_id: claimId });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  const {
    claim, lossSheet, lossItems, marineSheet, marineItems, ewClaim,
    ila, narrative: existingNarrative, template, signerHint,
    templateSource,
  } = ctx;

  // The button is disabled in the UI when source !== 'lifecycle' (or when no
  // lifecycle template has fsr_template_name set), but defence-in-depth:
  // refuse if the resolved template isn't a known one in narrativeFields.js.
  const schema = fieldsForLob(claim.lob, template.template_name);
  if (!Array.isArray(schema) || schema.length === 0) {
    return NextResponse.json(
      {
        error: `No narrative schema declared for (${claim.lob}, ${template.template_name}). ` +
          `Add it to lib/fsr/narrativeFields.js before this template can use AI auto-fill.`,
        code: 'NARRATIVE_SCHEMA_NOT_CONFIGURED',
      },
      { status: 409 }
    );
  }

  // ---- Gather evidence ----------------------------------------------------
  const ocrSummary = await readClaimDocuments({ claimId, triggeredBy: 'manual' })
    .catch((err) => {
      console.warn('[fsr-auto-prepare] OCR read failed:', err?.message || err);
      return { perDocument: [] };
    });
  const ocrDocs = (ocrSummary?.perDocument || [])
    .filter((d) => typeof d.text === 'string' && d.text.length > 0)
    .map((d) => ({
      filename: d.filename,
      mime_type: d.mime_type,
      ocr_text: d.text,
    }));

  let intimationBody = '';
  if (claim.intake_message_id) {
    const { data: msg } = await supabaseAdmin
      .from('inbox_messages')
      .select('body_plain')
      .eq('id', claim.intake_message_id)
      .maybeSingle();
    intimationBody = msg?.body_plain || '';
  }

  // ---- Build prompt + call LLM --------------------------------------------
  let llmResult;
  try {
    const { systemPrompt, userMessage } = buildAutoPreparePrompt({
      schema,
      claim,
      templateName: template.template_name,
      lossSheet: marineSheet || lossSheet,
      lossItems: marineItems?.length ? marineItems : lossItems,
      ila,
      ocrDocs,
      intimationBody,
    });
    llmResult = await callLLM({
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 4096,
      triggeredBy: 'manual',
    });
  } catch (err) {
    captureError(err, { area: 'fsr-auto-prepare-llm', claim_id: claimId });
    return NextResponse.json(
      { error: `LLM call failed: ${err?.message || err}` },
      { status: 502 }
    );
  }

  // ---- Parse + merge ------------------------------------------------------
  let parsed;
  try {
    parsed = parseAutoPrepareJson(llmResult.text);
  } catch (err) {
    captureError(err, {
      area: 'fsr-auto-prepare-parse',
      claim_id: claimId,
      raw_snippet: llmResult.text?.slice(0, 600),
    });
    return NextResponse.json(
      {
        error: `parse failed: ${err?.message || err}`,
        raw: llmResult.text?.slice(0, 1200),
      },
      { status: 502 }
    );
  }

  const { merged, filled, skipped, dropped } = mergeIntoNarrative(
    existingNarrative || {},
    parsed.values || {},
    schema
  );

  // ---- Re-render the draft body with the merged narrative -----------------
  // Inline the same renderFsrHtml the /render route uses, fed the same
  // context but with the new narrative — so the surveyor's preview pane
  // refreshes the moment they pick up the response.
  const renderCtx = buildContext({
    claim, lossSheet, lossItems, marineSheet, marineItems, ewClaim,
    ila,
    signer: signerHint
      ? {
          name: signerHint.signed_by_name || null,
          email: signerHint.signed_by_email || null,
          license_number: signerHint.signer_irdai_license_no || null,
        }
      : null,
    narrative: merged,
    company: claim.company || 'NISLA',
  });
  const html = substitute(template.body_html, renderCtx);

  // ---- Persist: update the latest draft, or insert if none ----------------
  const draft = await upsertDraft({
    claimId,
    lob: claim.lob,
    templateName: template.template_name,
    narrative: merged,
    html,
  });
  if (draft?.error) {
    if (draft.statusCode === 409) {
      return NextResponse.json({ error: draft.error }, { status: 409 });
    }
    captureError(new Error(draft.error), { area: 'fsr-auto-prepare-upsert', claim_id: claimId });
    return NextResponse.json({ error: draft.error }, { status: 500 });
  }

  // ---- Audit log ----------------------------------------------------------
  try {
    await supabaseAdmin.from('activity_log').insert([{
      action: 'fsr_narrative_auto_prepared',
      entity_type: 'claim',
      entity_id: String(claim.id),
      claim_id: claim.id,
      ref_number: claim.ref_number,
      user_email: userEmail,
      company: claim.company || 'NISLA',
      details: JSON.stringify({
        draft_id: draft.row.id,
        template_id: template.id,
        template_name: template.template_name,
        template_source: templateSource,
        filled,
        skipped,
        dropped,
        ocr_docs_used: ocrDocs.length,
        had_intimation_body: !!intimationBody,
        llm_provider: llmResult.provider,
        llm_model: llmResult.model,
        llm_tokens_in: llmResult.tokensIn,
        llm_tokens_out: llmResult.tokensOut,
        llm_cost_inr: llmResult.costInr,
        llm_latency_ms: llmResult.latencyMs,
      }),
    }]);
  } catch (logErr) {
    // Non-fatal — extraction succeeded; audit failure is logged only.
    console.warn('[fsr-auto-prepare] activity_log insert failed:', logErr?.message || logErr);
  }

  // ---- Response -----------------------------------------------------------
  return NextResponse.json({
    ok: true,
    draft: draft.row,
    narrative: merged,
    html,
    template: {
      id: template.id,
      name: template.template_name,
      version: template.version,
      source: templateSource,
    },
    stats: {
      filled,
      skipped,
      dropped,
      total_fields: schema.reduce((s, sec) => s + (sec.fields?.length || 0), 0),
      ocr_docs_used: ocrDocs.length,
      intimation_used: !!intimationBody,
    },
    llm: {
      provider: llmResult.provider,
      model: llmResult.model,
      cost_inr: llmResult.costInr,
      latency_ms: llmResult.latencyMs,
    },
    notes: parsed.notes || null,
  });
}

// ---- upsertDraft ------------------------------------------------------------
// Finds the latest draft and updates it in place (when status='draft') or
// inserts a fresh row (when status is approved/superseded — we don't bypass
// approvals; we 409 instead). Mirrors the render route's behaviour.
//
// Returns:
//   { row, error?: never }            — success
//   { error, statusCode }              — failure (409 for approved drafts; 500 otherwise)
// ----------------------------------------------------------------------------
async function upsertDraft({ claimId, lob, templateName, narrative, html }) {
  const { data: latest } = await supabaseAdmin
    .from('claim_fsr_drafts')
    .select('id, version_number, status')
    .eq('claim_id', claimId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest && (latest.status === 'approved' || latest.status === 'superseded')) {
    return {
      error: `Latest draft is ${latest.status}; supersede it explicitly before auto-prepare can re-fill the narrative`,
      statusCode: 409,
    };
  }

  if (latest && latest.status === 'draft') {
    const updates = sanitiseDraftPayload({
      draft_content: html,
      template_name: templateName,
      narrative_jsonb: narrative,
    });
    const { data, error } = await supabaseAdmin
      .from('claim_fsr_drafts')
      .update(updates)
      .eq('id', latest.id)
      .select()
      .single();
    if (error) return { error: error.message };
    return { row: data };
  }

  // No draft at all (or under_review which we treat as locked-but-snapshot-able).
  const nextVersion = latest ? latest.version_number + 1 : 1;
  const { data, error } = await supabaseAdmin
    .from('claim_fsr_drafts')
    .insert([{
      claim_id: claimId,
      lob: lob || null,
      draft_content: html,
      template_name: templateName,
      narrative_jsonb: narrative,
      status: 'draft',
      version_number: nextVersion,
    }])
    .select()
    .single();
  if (error) return { error: error.message };
  return { row: data };
}

// =============================================================================
// /api/claims/[id]/registration-extract
// =============================================================================
// POST — runs the Claim Registration Agent (rich on-demand LLM extraction)
// against the claim's documents (claim_documents) plus, when present, the
// originating intimation email body. Persists the result to
// claim_registration_extractions and returns the rich shape the registration
// form consumes.
//
// Source:
//   claim_documents  — always (unified document store post-PR #38).
//                      Email attachments are materialised here; manual-claim
//                      uploads land here too. OCR cached on
//                      claim_documents.ocr_text (post-migration
//                      20260504073537).
//   inbox_messages   — only when claim.intake_message_id is set (email-
//                      sourced claims). Body is passed to the prompt as
//                      intimation_email context.
//   extraction_results — only when intake_message_id is set; the lean-pass
//                      extraction is fed in as "existing JSON" priority.
//
// Body / query: { force?: boolean } | ?force=true
//
// Idempotency: if a row exists for this claim with created_at within the last
// 5 minutes AND force is not set, the cached row is returned (no LLM call).
//
// Response (200):
//   {
//     id, claim_id, fields, conflicts, missing_critical_fields,
//     extraction_notes, llm_provider, llm_model, llm_cost_inr,
//     created_at, cached: boolean
//   }
//
// 502 — LLM call or JSON parse failed (a row is still persisted with the
//       error so the next force=true retry has a baseline)
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';
import { wrapCallLLM } from '@/lib/comms/piiMasker';
import { readClaimDocuments } from '@/lib/comms/claimDocumentReader';
import { recordPortalActivity } from '@/lib/comms/auditLog';
import {
  buildRegistrationPrompt,
  parseRegistrationJson,
} from '@/lib/comms/prompts/registrationAgentPrompt';
import {
  buildPolicyAgentPrompt,
  parsePolicyAgentJson,
} from '@/lib/comms/prompts/policyRegistrationAgentPrompt';
import { findCandidatePolicies } from '@/lib/comms/policyCandidateLookup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 5-min budget — comfortable for one OCR pass (cached after first run) + one LLM call.
export const maxDuration = 300;

const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000;
const MULTI_COMPANY_ROLES = new Set(['all', 'development']);

export async function POST(request, { params }) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  const { id } = params || {};
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  let body = {};
  try { body = await request.json(); } catch { /* no body is fine */ }
  const force = body?.force === true || searchParams.get('force') === 'true';

  // ---------------------------------------------------------------------------
  // 1. Load claim + scope check
  // ---------------------------------------------------------------------------
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from('claims')
    .select('id, ref_number, lob, company, intake_message_id')
    .eq('id', id)
    .maybeSingle();

  if (claimErr || !claim) {
    return NextResponse.json(
      { error: claimErr?.message || 'claim not found' },
      { status: 404 }
    );
  }

  const userCompanyKey = String(user.company || '').toLowerCase();
  const isMultiCompany = MULTI_COMPANY_ROLES.has(userCompanyKey);
  if (!isMultiCompany && user.company !== claim.company) {
    return NextResponse.json({ error: 'forbidden: cross-company access' }, { status: 403 });
  }

  // ---------------------------------------------------------------------------
  // 2. Idempotency: return latest row if within window and not forced
  // ---------------------------------------------------------------------------
  const { data: latest } = await supabaseAdmin
    .from('claim_registration_extractions')
    .select('*')
    .eq('claim_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!force && latest && latest.created_at) {
    const ageMs = Date.now() - new Date(latest.created_at).getTime();
    if (Number.isFinite(ageMs) && ageMs < IDEMPOTENCY_WINDOW_MS) {
      return NextResponse.json({
        ...formatRow(latest),
        cached: true,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Load OCR + (when applicable) email body + lean-pass extraction
  // ---------------------------------------------------------------------------
  // claim_documents is always the source of truth for documents (PR #38
  // unified email attachments + uploads + generated artifacts). The
  // inbox_messages body and the lean-pass extraction_results are only
  // available for email-sourced claims; manual claims skip those reads.
  const triggeredBy = force ? 'manual' : 'auto';

  const tasks = [
    readClaimDocuments({ claimId: claim.id, triggeredBy }).catch((err) => {
      console.warn('[registration-extract] OCR read failed:', err?.message || err);
      return { combinedText: '', perDocument: [], totalPages: 0, totalCostInr: 0 };
    }),
  ];

  if (claim.intake_message_id) {
    tasks.push(
      supabaseAdmin
        .from('inbox_messages')
        .select('id, subject, body_plain, from_address, received_at, company')
        .eq('id', claim.intake_message_id)
        .maybeSingle()
    );
    tasks.push(
      supabaseAdmin
        .from('extraction_results')
        .select('extracted_data, validation_errors, is_valid')
        .eq('message_id', claim.intake_message_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    );
  }

  const results = await Promise.all(tasks);
  const ocrSummary = results[0];
  const messageRes = claim.intake_message_id ? results[1] : null;
  const existingExtRes = claim.intake_message_id ? results[2] : null;
  const message = messageRes?.data || null;
  const existingExt = existingExtRes?.data || null;

  // ---------------------------------------------------------------------------
  // 4. Build prompt + call LLM
  // ---------------------------------------------------------------------------
  const { systemPrompt, userMessage } = buildRegistrationPrompt({
    claim,
    intimation: message,
    attachments: ocrSummary?.perDocument || [],
    ocrText: ocrSummary?.combinedText || '',
    existingExtraction: existingExt?.extracted_data || null,
  });

  let llmResult;
  try {
    llmResult = await wrapCallLLM({
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 2048,
      messageId: claim.intake_message_id || null,
      triggeredBy,
    });
  } catch (err) {
    return persistAndReturnError({
      claim,
      err: `LLM call failed: ${err?.message || err}`,
      triggeredBy,
      user,
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Parse rich JSON
  // ---------------------------------------------------------------------------
  let parsed;
  try {
    parsed = parseRegistrationJson(llmResult.text);
  } catch (err) {
    return persistAndReturnError({
      claim,
      err: `parse failed: ${err?.message || err}`,
      triggeredBy,
      user,
      llmResult,
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Persist successful extraction
  // ---------------------------------------------------------------------------
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('claim_registration_extractions')
    .insert([{
      claim_id: claim.id,
      message_id: claim.intake_message_id || null,
      fields_json: parsed.fields,
      conflicts_json: parsed.conflicts,
      missing_critical: parsed.missing_critical_fields,
      extraction_notes: parsed.extraction_notes || null,
      llm_provider: llmResult.provider || null,
      llm_model: llmResult.model || null,
      llm_tokens_in: llmResult.tokensIn || null,
      llm_tokens_out: llmResult.tokensOut || null,
      llm_cost_inr: llmResult.costInr || null,
      triggered_by: triggeredBy,
      triggered_by_user: user.email,
    }])
    .select('*')
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: `persist failed: ${insertErr?.message || 'unknown'}` },
      { status: 500 }
    );
  }

  // ---------------------------------------------------------------------------
  // 7. Chain the Policy Registration Agent
  // ---------------------------------------------------------------------------
  // Inputs: the policy-shaped subset of the Claim Agent's just-parsed fields
  // + a deterministic candidate-list lookup against the `policies` master.
  // Output is persisted on the SAME row we just inserted (policy_decision_json
  // column from migration 20260504093654). Failures here are non-fatal — the
  // Claim Agent's output is the primary product; the policy decision is an
  // enrichment.
  let policyDecision = null;
  let policyLlm = null;
  try {
    const extractedPolicy = extractPolicyFieldsFrom(parsed.fields || {});
    const candidates = await findCandidatePolicies({
      supabase: supabaseAdmin,
      policyNumber: extractedPolicy.policy_number?.value,
      insurer:      extractedPolicy.insurer?.value,
      insuredName:  extractedPolicy.insured_name?.value,
      company:      claim.company,
    });

    const policyPrompt = buildPolicyAgentPrompt({
      extractedPolicy,
      candidateMatches: candidates,
      claimContext: {
        claim_id:    claim.id,
        ref_number:  claim.ref_number,
        lob:         claim.lob,
        company:     claim.company,
      },
    });

    policyLlm = await wrapCallLLM({
      systemPrompt: policyPrompt.systemPrompt,
      messages: [{ role: 'user', content: policyPrompt.userMessage }],
      maxTokens: 1024,
      messageId: claim.intake_message_id || null,
      triggeredBy,
    });
    policyDecision = parsePolicyAgentJson(policyLlm.text);

    // Persist the decision on the same row.
    await supabaseAdmin
      .from('claim_registration_extractions')
      .update({ policy_decision_json: policyDecision })
      .eq('id', inserted.id);
  } catch (err) {
    console.warn('[registration-extract] Policy Agent failed:', err?.message || err);
    // Leave policy_decision_json NULL on the row; UI shows "decision pending".
  }

  // ---------------------------------------------------------------------------
  // 8. Audit (non-fatal)
  // ---------------------------------------------------------------------------
  await recordPortalActivity({
    user_email: user.email,
    user_name: user.name || user.email,
    action: 'claim_registration_extracted',
    entity_type: 'claim',
    entity_id: claim.id,
    claim_id: claim.id,
    ref_number: claim.ref_number || null,
    company: claim.company || 'NISLA',
    details: {
      extraction_id: inserted.id,
      triggered_by: triggeredBy,
      llm_provider: llmResult.provider,
      llm_cost_inr: llmResult.costInr,
      conflicts_count: (parsed.conflicts || []).length,
      missing_critical_count: (parsed.missing_critical_fields || []).length,
      source_kind: claim.intake_message_id ? 'email' : 'manual',
      docs_ocr_pages: ocrSummary?.totalPages || 0,
      policy_decision: policyDecision?.decision || null,
      policy_llm_cost_inr: policyLlm?.costInr || null,
    },
  });

  return NextResponse.json({
    ...formatRow({ ...inserted, policy_decision_json: policyDecision }),
    cached: false,
  });
}

// -----------------------------------------------------------------------------
// extractPolicyFieldsFrom — projects the Claim Agent's `fields` map onto
// the policy-shaped slice the Policy Agent consumes. Only the keys the
// Policy Agent's prompt expects are forwarded; missing keys stay missing.
// -----------------------------------------------------------------------------
function extractPolicyFieldsFrom(claimFields) {
  const POLICY_KEYS = [
    'policy_number',
    'insurer_name',     // we'll re-key below
    'insurer_branch',
    'insured_name',
    'insured_address',
    'insured_contact_phone',
    'insured_contact_email',
    'lob',
    'policy_type',
    'sum_insured',
    'policy_period_from',
    'policy_period_to',
  ];
  const out = {};
  for (const k of POLICY_KEYS) {
    if (claimFields[k]) out[k] = claimFields[k];
  }
  // Rename for the Policy Agent's vocabulary (which uses 'insurer' not
  // 'insurer_name', 'start_date' not 'policy_period_from', etc.).
  if (out.insurer_name)      { out.insurer    = out.insurer_name;      delete out.insurer_name; }
  if (out.insurer_branch)    { out.insurer_office = out.insurer_branch; delete out.insurer_branch; }
  if (out.insured_contact_phone) { out.phone = out.insured_contact_phone; delete out.insured_contact_phone; }
  if (out.insured_contact_email) { out.email = out.insured_contact_email; delete out.insured_contact_email; }
  if (out.policy_period_from){ out.start_date = out.policy_period_from; delete out.policy_period_from; }
  if (out.policy_period_to)  { out.end_date   = out.policy_period_to;   delete out.policy_period_to; }
  return out;
}

// -----------------------------------------------------------------------------
// formatRow — shape a claim_registration_extractions row for the client.
// -----------------------------------------------------------------------------
function formatRow(row) {
  return {
    id: row.id,
    claim_id: row.claim_id,
    fields: row.fields_json || {},
    conflicts: row.conflicts_json || [],
    missing_critical_fields: row.missing_critical || [],
    extraction_notes: row.extraction_notes || '',
    llm_provider: row.llm_provider,
    llm_model: row.llm_model,
    llm_cost_inr: row.llm_cost_inr,
    created_at: row.created_at,
    triggered_by: row.triggered_by,
    // Policy Registration Agent output (may be null — agent failed, hadn't
    // run yet, or this row predates the chained-agent migration).
    policy_decision: row.policy_decision_json || null,
  };
}

// -----------------------------------------------------------------------------
// persistAndReturnError — write a row capturing the failure so the next
// retry has a baseline + audit trail. Returns 502.
// -----------------------------------------------------------------------------
async function persistAndReturnError({ claim, err, triggeredBy, user, llmResult = null }) {
  await supabaseAdmin
    .from('claim_registration_extractions')
    .insert([{
      claim_id: claim.id,
      message_id: claim.intake_message_id || null,
      fields_json: {},
      conflicts_json: [],
      missing_critical: [],
      extraction_notes: String(err).slice(0, 200),
      llm_provider: llmResult?.provider || null,
      llm_model: llmResult?.model || null,
      llm_tokens_in: llmResult?.tokensIn || null,
      llm_tokens_out: llmResult?.tokensOut || null,
      llm_cost_inr: llmResult?.costInr || null,
      triggered_by: triggeredBy,
      triggered_by_user: user.email,
    }]);

  return NextResponse.json({ error: err }, { status: 502 });
}

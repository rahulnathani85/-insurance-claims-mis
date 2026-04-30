// =============================================================================
// /api/ila-drafts/[id]/submit
// =============================================================================
// POST — Final submission of an ILA draft (spec §7 submission gate, §9 PDF):
//   1. Validate signer's IRDAI license (block if expired)
//   2. Render the draft to HTML and convert to PDF via puppeteer-server
//   3. Save the PDF to the claim's file-server folder
//   4. Compute TAT compliance vs claims.ila_due_at
//   5. Insert ila_submissions row + co-signers (if any)
//   6. Mark the draft as 'approved' (immutable)
//   7. Enqueue email-to-insurer notification
//   8. Audit log
//
// Body:
//   {
//     signer_email: string (required) — IRDAI-licensed surveyor signing off
//     submitted_to_email?: string     — insurer dealing-officer email
//     tat_breach_reason?: string      — required when submission is past
//                                        ila_due_at; spec §10
//     co_signers?: [{ user_email, user_name, role, irdai_license_no }]
//   }
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { renderIlaHtml, computeTatCompliance } from '@/lib/ila';
import { isEligibleForAssignment } from '@/lib/surveyors';
import { FILE_SERVER_URL, PUPPETEER_URL, buildHeaders } from '@/lib/apiGateway';
import { enqueue } from '@/lib/notifications/queue';
import { captureError } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request, { params }) {
  const { id: draftId } = params;
  const body = await request.json().catch(() => ({}));

  const signerEmail = (body.signer_email || '').trim().toLowerCase();
  if (!signerEmail) {
    return NextResponse.json({ error: 'signer_email is required' }, { status: 400 });
  }

  // 1. Load draft + claim
  const { data: draft, error: draftErr } = await supabaseAdmin
    .from('ila_drafts')
    .select('*')
    .eq('id', draftId)
    .single();
  if (draftErr || !draft) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }
  if (draft.status === 'approved' || draft.status === 'superseded') {
    return NextResponse.json(
      { error: `Draft already ${draft.status}` },
      { status: 409 }
    );
  }

  // Mandatory section gate (spec §7).
  const missing = [];
  if (!draft.preliminary_view) missing.push('preliminary_view');
  if (!draft.admissibility_opinion) missing.push('admissibility_opinion');
  if (!draft.next_steps) missing.push('next_steps');
  if (!draft.expected_fsr_date) missing.push('expected_fsr_date');
  if (!Array.isArray(draft.documents_required) || draft.documents_required.length === 0) {
    missing.push('documents_required');
  }
  if (missing.length > 0) {
    return NextResponse.json(
      { error: 'Missing mandatory ILA sections', missing },
      { status: 422 }
    );
  }

  const { data: claim, error: claimErr } = await supabaseAdmin
    .from('claims')
    .select('*')
    .eq('id', draft.claim_id)
    .single();
  if (claimErr || !claim) {
    return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  }

  // 2. Validate signer — must be a surveyor with valid IRDAI license.
  const { data: signer } = await supabaseAdmin
    .from('surveyors')
    .select('id, name, email, license_number, license_category, license_expiry_date, active')
    .ilike('email', signerEmail)
    .maybeSingle();
  if (!signer) {
    return NextResponse.json(
      { error: `No surveyor record for ${signerEmail}. ILA must be signed by an IRDAI-licensed surveyor.` },
      { status: 400 }
    );
  }
  const elig = isEligibleForAssignment(signer);
  if (!elig.eligible) {
    return NextResponse.json(
      { error: `Signer not eligible: ${elig.reason}` },
      { status: 400 }
    );
  }

  // 3. TAT check + breach reason gate (spec §10).
  const submittedAt = new Date();
  const tat = computeTatCompliance(submittedAt, claim.ila_due_at);
  if (!tat.compliant && !body.tat_breach_reason) {
    return NextResponse.json(
      {
        error: 'ILA is past ila_due_at — tat_breach_reason is mandatory',
        breach_hours: tat.breach_hours,
      },
      { status: 422 }
    );
  }

  // 4. Render HTML + convert to PDF.
  const html = renderIlaHtml({
    claim,
    draft,
    signer: {
      name: signer.name,
      email: signer.email,
      license_number: signer.license_number,
      license_category: signer.license_category,
    },
    company: claim.company || 'NISLA',
  });

  let pdfMeta = null;
  try {
    pdfMeta = await renderPdfToFileServer({ html, claim, draftVersion: draft.version });
  } catch (e) {
    // PDF failure is bad but not fatal — we still record the submission so
    // the regulatory audit trail captures the signoff. The PDF can be
    // regenerated later. Log to observability so this is visible in prod.
    captureError(e, { area: 'ila-submit-pdf', draft_id: draftId, claim_id: claim.id });
  }

  // 5. Insert submission row.
  const { data: submission, error: subErr } = await supabaseAdmin
    .from('ila_submissions')
    .insert([{
      claim_id: claim.id,
      draft_id: draft.id,
      signed_by_email: signer.email,
      signed_by_name: signer.name,
      signer_irdai_license_no: signer.license_number,
      signer_category: signer.license_category,
      pdf_storage_path: pdfMeta?.storage_path || null,
      pdf_hash: pdfMeta?.hash || null,
      pdf_size_bytes: pdfMeta?.size_bytes || null,
      submitted_at: submittedAt.toISOString(),
      submitted_via: body.submitted_to_email ? 'email' : 'manual',
      submitted_to_email: body.submitted_to_email || null,
      tat_compliant: tat.compliant,
      tat_breach_reason: tat.compliant ? null : body.tat_breach_reason,
      company: claim.company || 'NISLA',
    }])
    .select()
    .single();
  if (subErr) {
    return NextResponse.json({ error: subErr.message }, { status: 500 });
  }

  // Co-signers (Phase 1 stores; Phase 2 enforces gate).
  if (Array.isArray(body.co_signers) && body.co_signers.length > 0) {
    const cosignRows = body.co_signers
      .filter((c) => c && c.user_email && c.role)
      .map((c) => ({
        submission_id: submission.id,
        surveyor_id: c.surveyor_id || null,
        user_email: c.user_email,
        user_name: c.user_name || null,
        role: c.role,
        irdai_license_no: c.irdai_license_no || null,
      }));
    if (cosignRows.length > 0) {
      await supabaseAdmin.from('ila_co_signers').insert(cosignRows);
    }
  }

  // 6. Mark draft approved (immutable).
  await supabaseAdmin
    .from('ila_drafts')
    .update({ status: 'approved', updated_at: submittedAt.toISOString(), updated_by: signer.email })
    .eq('id', draftId);

  // Supersede earlier non-approved drafts on the same claim.
  await supabaseAdmin
    .from('ila_drafts')
    .update({ status: 'superseded', updated_at: submittedAt.toISOString() })
    .eq('claim_id', claim.id)
    .neq('id', draftId)
    .in('status', ['draft', 'under_review']);

  // 7. Enqueue email-to-insurer notification (spec §11).
  let queuedNotificationId = null;
  if (body.submitted_to_email) {
    try {
      const result = await enqueue(supabaseAdmin, {
        notification_type: 'ila_submitted',
        claim_id: claim.id,
        recipient_email: body.submitted_to_email,
        recipient_name: claim.dealing_officer_name || null,
        company: claim.company || 'NISLA',
        context: {
          claim_ref: claim.ref_number || `#${claim.id}`,
          insured_name: claim.insured_name || 'Insured',
          insurer_name: claim.insurer_name || null,
          signer_name: signer.name,
          signer_license: signer.license_number,
          submitted_at: submittedAt.toISOString(),
          pdf_storage_path: pdfMeta?.storage_path || null,
          tat_compliant: tat.compliant,
          company: claim.company || 'NISLA',
        },
      });
      queuedNotificationId = result?.id || null;
      if (queuedNotificationId) {
        await supabaseAdmin
          .from('ila_submissions')
          .update({ submission_notification_id: queuedNotificationId })
          .eq('id', submission.id);
      }
    } catch (e) {
      captureError(e, { area: 'ila-submit-notify', submission_id: submission.id });
    }
  }

  // 8. Audit log.
  await supabaseAdmin.from('activity_log').insert([{
    action: 'ila_submitted',
    entity_type: 'claim',
    entity_id: String(claim.id),
    claim_id: claim.id,
    ref_number: claim.ref_number,
    user_email: signer.email,
    user_name: signer.name,
    company: claim.company || 'NISLA',
    details: JSON.stringify({
      draft_id: draft.id,
      submission_id: submission.id,
      tat_compliant: tat.compliant,
      breach_hours: tat.breach_hours || 0,
      pdf: pdfMeta ? 'rendered' : 'pdf_failed',
      submitted_to_email: body.submitted_to_email || null,
    }),
  }]);

  return NextResponse.json({
    ok: true,
    submission,
    tat,
    pdf: pdfMeta,
    notification_id: queuedNotificationId,
  });
}

// Helper: send HTML to puppeteer-server, get back a saved PDF path.
async function renderPdfToFileServer({ html, claim, draftVersion }) {
  // Folder layout mirrors EW media path conventions.
  const safeRef = (claim.ref_number || `claim-${claim.id}`).replace(/[<>:"/\\|?*]/g, '_');
  const safeName = (claim.insured_name || 'Unknown').replace(/[<>:"/\\|?*]/g, '_').slice(0, 50);
  const folder = claim.folder_path
    ? claim.folder_path.replace(/^D:\\\\?2026-27\\\\?/, '').replace(/^D:\\2026-27\\?/, '')
    : `${claim.company || 'NISLA'}\\${safeRef} - ${safeName}`;
  const targetFolder = `${folder}\\ILA`;
  const filename = `ILA-${safeRef}-v${draftVersion}.pdf`;

  const res = await fetch(`${PUPPETEER_URL}/api/html-to-pdf`, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ html, folder_path: targetFolder, filename }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Puppeteer error: ${data.error || res.statusText}`);
  }

  // Build the proxy URL the same way the EW media route does.
  const downloadPath = data.downloadUrl || data.files?.[0]?.downloadUrl || '';
  const m = downloadPath.match(/[?&]path=([^&]+)/);
  const filePath = m ? decodeURIComponent(m[1]) : '';

  return {
    storage_path: filePath ? `/api/file-proxy?path=${encodeURIComponent(filePath)}` : null,
    raw_path: filePath,
    hash: data.hash || null,
    size_bytes: data.size_bytes || data.size || null,
    filename,
  };
}

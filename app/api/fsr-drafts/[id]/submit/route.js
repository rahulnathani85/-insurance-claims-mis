// =============================================================================
// /api/fsr-drafts/[id]/submit
// =============================================================================
// POST — final submission of the FSR draft:
//   1. Validate signer's IRDAI license (block if expired or missing)
//   2. Render the current draft_content to PDF via puppeteer-server
//   3. Save under D:\2026-27\<company>\<ref>\FSR\
//   4. Mark draft 'approved' (immutable); supersede earlier non-approved
//      drafts on the same claim
//   5. Enqueue email-to-insurer notification (reuses ila_submitted template;
//      a dedicated fsr_submitted template is Phase 2)
//   6. Audit log
//
// Body:
//   {
//     signer_email: string (required)
//     submitted_to_email?: string
//   }
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isEligibleForAssignment } from '@/lib/surveyors';
import { FILE_SERVER_URL, PUPPETEER_URL, buildHeaders } from '@/lib/apiGateway';
import { enqueue } from '@/lib/notifications/queue';
import { captureError } from '@/lib/observability';
import { requireSurveyorRequest } from '@/lib/auth/insurer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request, { params }) {
  // Phase 2 mutation guard
  try {
    await requireSurveyorRequest(request);
  } catch (e) {
    if (e?.code === 'INSURER_FORBIDDEN') {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    throw e;
  }

  const { id: draftId } = params;
  const body = await request.json().catch(() => ({}));

  const signerEmail = (body.signer_email || '').trim().toLowerCase();
  if (!signerEmail) {
    return NextResponse.json({ error: 'signer_email is required' }, { status: 400 });
  }

  const { data: draft, error: draftErr } = await supabaseAdmin
    .from('claim_fsr_drafts')
    .select('*')
    .eq('id', draftId)
    .single();
  if (draftErr || !draft) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }
  if (draft.status === 'approved' || draft.status === 'superseded') {
    return NextResponse.json({ error: `Draft already ${draft.status}` }, { status: 409 });
  }
  if (!draft.draft_content) {
    return NextResponse.json({ error: 'Draft has no content to render' }, { status: 422 });
  }

  const { data: claim, error: claimErr } = await supabaseAdmin
    .from('claims')
    .select('*')
    .eq('id', draft.claim_id)
    .single();
  if (claimErr || !claim) {
    return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  }

  // Signer eligibility (IRDAI license valid + active)
  const { data: signer } = await supabaseAdmin
    .from('surveyors')
    .select('id, name, email, license_number, license_category, license_expiry_date, active')
    .ilike('email', signerEmail)
    .maybeSingle();
  if (!signer) {
    return NextResponse.json(
      { error: `No surveyor record for ${signerEmail}. FSR must be signed by an IRDAI-licensed surveyor.` },
      { status: 400 }
    );
  }
  const elig = isEligibleForAssignment(signer);
  if (!elig.eligible) {
    return NextResponse.json({ error: `Signer not eligible: ${elig.reason}` }, { status: 400 });
  }

  // Render PDF — non-fatal on failure (audit row still gets written so we
  // have the regulatory signoff record).
  let pdfMeta = null;
  try {
    pdfMeta = await renderFsrPdf({ html: draft.draft_content, claim, version: draft.version_number });
  } catch (e) {
    captureError(e, { area: 'fsr-submit-pdf', draft_id: draftId, claim_id: claim.id });
  }

  const submittedAt = new Date().toISOString();

  // Mark approved (immutable). claim_fsr_drafts has approved_by/approved_at.
  await supabaseAdmin
    .from('claim_fsr_drafts')
    .update({
      status: 'approved',
      approved_by: signer.email,
      approved_at: submittedAt,
    })
    .eq('id', draftId);

  // Supersede earlier non-approved drafts on this claim.
  await supabaseAdmin
    .from('claim_fsr_drafts')
    .update({ status: 'superseded' })
    .eq('claim_id', claim.id)
    .neq('id', draftId)
    .in('status', ['draft', 'under_review']);

  // Surface the FSR PDF on the claim's unified Documents tab. Non-fatal —
  // the FSR is regulatory-signed-off whether or not this insert succeeds.
  if (pdfMeta) {
    try {
      await supabaseAdmin.from('claim_documents').insert([{
        claim_id: claim.id,
        ref_number: claim.ref_number || null,
        document_type: 'FSR',
        document_name: `FSR ${claim.ref_number || claim.id} v${draft.version_number}`,
        file_name: pdfMeta.filename || `FSR-${claim.ref_number || claim.id}-v${draft.version_number}.pdf`,
        file_type: 'survey_report',
        mime_type: 'application/pdf',
        file_size: pdfMeta.size_bytes || null,
        // pdfMeta.storage_path is a /api/file-proxy?path=... URL, not a
        // Supabase bucket key — keep claim_documents.storage_path null and
        // use file_url instead so the unified GET serves it via fallback.
        file_url: pdfMeta.storage_path || null,
        source: 'generated',
        status: 'Submitted',
        uploaded_by: signer.email,
        company: claim.company || 'NISLA',
      }]);
    } catch (e) {
      captureError(e, { area: 'fsr-submit-claim-doc', draft_id: draftId, claim_id: claim.id });
    }
  }

  // Enqueue insurer notification — reuses the ila_submitted template shape
  // (subject + body fields are claim-agnostic enough). A dedicated
  // fsr_submitted template lives in Phase 2.
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
          submitted_at: submittedAt,
          pdf_storage_path: pdfMeta?.storage_path || null,
          tat_compliant: true,
          company: claim.company || 'NISLA',
        },
      });
      queuedNotificationId = result?.id || null;
    } catch (e) {
      captureError(e, { area: 'fsr-submit-notify', draft_id: draftId });
    }
  }

  // Audit
  await supabaseAdmin.from('activity_log').insert([{
    action: 'fsr_submitted',
    entity_type: 'claim',
    entity_id: String(claim.id),
    claim_id: claim.id,
    ref_number: claim.ref_number,
    user_email: signer.email,
    user_name: signer.name,
    company: claim.company || 'NISLA',
    details: JSON.stringify({
      draft_id: draft.id,
      version: draft.version_number,
      pdf: pdfMeta ? 'rendered' : 'pdf_failed',
      submitted_to_email: body.submitted_to_email || null,
      notification_id: queuedNotificationId,
    }),
  }]);

  return NextResponse.json({
    ok: true,
    draft_id: draftId,
    pdf: pdfMeta,
    notification_id: queuedNotificationId,
    submitted_at: submittedAt,
  });
}

async function renderFsrPdf({ html, claim, version }) {
  const safeRef = (claim.ref_number || `claim-${claim.id}`).replace(/[<>:"/\\|?*]/g, '_');
  const safeName = (claim.insured_name || 'Unknown').replace(/[<>:"/\\|?*]/g, '_').slice(0, 50);
  const folder = claim.folder_path
    ? claim.folder_path.replace(/^D:\\\\?2026-27\\\\?/, '').replace(/^D:\\2026-27\\?/, '')
    : `${claim.company || 'NISLA'}\\${safeRef} - ${safeName}`;
  const targetFolder = `${folder}\\FSR`;
  const filename = `FSR-${safeRef}-v${version}.pdf`;

  const res = await fetch(`${PUPPETEER_URL}/api/html-to-pdf`, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ html, folder_path: targetFolder, filename }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Puppeteer error: ${data.error || res.statusText}`);
  }

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

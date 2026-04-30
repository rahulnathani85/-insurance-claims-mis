// =============================================================================
// /api/claims/[id]/fsr-drafts
// =============================================================================
// GET  — list FSR drafts for a claim, newest first
// POST — generate a new FSR draft from the LOB template, claim, latest ILA,
//        and loss sheet. Auto-versions (max + 1).
//
// Body for POST (optional):
//   { template_name?: 'Default' }
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { loadFsrContext, renderFsrHtml } from '@/lib/fsr';

export const runtime = 'nodejs';

export async function GET(_request, { params }) {
  const { id } = params;
  const { data, error } = await supabaseAdmin
    .from('claim_fsr_drafts')
    .select('*')
    .eq('claim_id', id)
    .order('version_number', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(request, { params }) {
  const { id } = params;
  const body = await request.json().catch(() => ({}));

  let context;
  try {
    context = await loadFsrContext(supabaseAdmin, {
      claimId: id,
      company: body.company,
      lob: body.lob,
      templateName: body.template_name || 'Default',
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  // Render initial HTML using the signer hint from the last ILA submission
  // (clerk overrides at submit time anyway).
  const html = renderFsrHtml({
    ...context,
    signer: context.signerHint
      ? {
          name: context.signerHint.signed_by_name,
          email: context.signerHint.signed_by_email,
          license_number: context.signerHint.signer_irdai_license_no,
        }
      : null,
  });

  // Auto-version
  const { data: maxRow } = await supabaseAdmin
    .from('claim_fsr_drafts')
    .select('version_number')
    .eq('claim_id', id)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (maxRow?.version_number || 0) + 1;

  const { data: created, error } = await supabaseAdmin
    .from('claim_fsr_drafts')
    .insert([{
      claim_id: parseInt(id, 10),
      lob: context.claim.lob,
      draft_content: html,
      status: 'draft',
      version_number: nextVersion,
    }])
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    draft: created,
    template: { id: context.template.id, name: context.template.template_name, version: context.template.version },
    has_loss_sheet: !!context.lossSheet,
    has_ila: !!context.ila,
  }, { status: 201 });
}

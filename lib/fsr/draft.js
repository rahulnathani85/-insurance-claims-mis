// =============================================================================
// lib/fsr/draft.js
// =============================================================================
// Helpers for the Fire FSR drafting flow:
//   - loadFsrContext      — pulls claim + loss sheet + items + latest ILA
//                           submission's draft for an FSR generation
//   - sanitiseDraftPayload — trims + validates fields the UI can edit
// =============================================================================

const ALLOWED_STATUSES = ['draft', 'under_review', 'approved', 'superseded'];

// Pull all the data needed to render an FSR from scratch.
//
// Returns: { claim, lossSheet, lossItems, ila, template }
// Throws on missing claim or no template for (company, lob).
export async function loadFsrContext(supabase, { claimId, company, lob, templateName = 'Default' }) {
  // Claim
  const { data: claim, error: claimErr } = await supabase
    .from('claims')
    .select('*')
    .eq('id', claimId)
    .single();
  if (claimErr || !claim) {
    throw new Error('Claim not found');
  }

  // Loss sheet + items (may be null if surveyor hasn't created one yet)
  const { data: lossSheet } = await supabase
    .from('loss_sheets')
    .select('*')
    .eq('claim_id', claimId)
    .maybeSingle();
  let lossItems = [];
  if (lossSheet) {
    const { data } = await supabase
      .from('loss_sheet_items')
      .select('*')
      .eq('loss_sheet_id', lossSheet.id)
      .order('item_no', { ascending: true });
    lossItems = data || [];
  }

  // Latest ILA submission's draft (for preliminary view + admissibility)
  const { data: lastSubmission } = await supabase
    .from('ila_submissions')
    .select('draft_id, signed_by_email, signer_irdai_license_no, signed_by_name, signer_category')
    .eq('claim_id', claimId)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  let ila = null;
  if (lastSubmission?.draft_id) {
    const { data: draft } = await supabase
      .from('ila_drafts')
      .select('preliminary_view, admissibility_opinion, admissibility_reasoning, expected_fsr_date')
      .eq('id', lastSubmission.draft_id)
      .maybeSingle();
    ila = draft;
  }

  // Template (company + lob)
  const { data: template, error: tplErr } = await supabase
    .from('fsr_lob_templates')
    .select('*')
    .eq('company', company || claim.company || 'NISLA')
    .eq('lob', lob || claim.lob || 'Fire')
    .eq('template_name', templateName)
    .eq('is_active', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (tplErr || !template) {
    throw new Error(`No active FSR template for ${company || claim.company} / ${lob || claim.lob}. Seed one in fsr_lob_templates.`);
  }

  return { claim, lossSheet, lossItems, ila, template, signerHint: lastSubmission };
}

// Sanitises a PUT body for claim_fsr_drafts.
//
// Editable fields:
//   draft_content   the rendered HTML (surveyor may edit before submit)
//   status          enum
//   approved_by     email
export function sanitiseDraftPayload(body = {}) {
  const out = {};
  if (body.draft_content !== undefined) {
    out.draft_content = typeof body.draft_content === 'string'
      ? body.draft_content
      : null;
  }
  if (body.status !== undefined) {
    if (!ALLOWED_STATUSES.includes(body.status)) {
      throw new Error(`status must be one of: ${ALLOWED_STATUSES.join(', ')}`);
    }
    out.status = body.status;
  }
  if (body.approved_by !== undefined) {
    out.approved_by = typeof body.approved_by === 'string' ? body.approved_by.trim() : null;
  }
  return out;
}

export { ALLOWED_STATUSES };

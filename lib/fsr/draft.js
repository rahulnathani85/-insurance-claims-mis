// =============================================================================
// lib/fsr/draft.js
// =============================================================================
// Helpers for the FSR drafting flow:
//   - loadFsrContext      — pulls claim + LOB-appropriate loss sheet + items +
//                           latest ILA submission's draft + the active
//                           fsr_lob_templates row + any saved narrative_jsonb
//   - sanitiseDraftPayload — trims + validates fields the UI can edit
//
// Multi-LOB awareness: this helper now reads from `marine_loss_sheets` /
// `marine_loss_sheet_items` for Marine claims, `ew_vehicle_claims` for
// Extended Warranty claims, and the original `loss_sheets` / `loss_sheet_items`
// for Fire claims. Other LOBs fall through to the claim row only.
// =============================================================================

const ALLOWED_STATUSES = ['draft', 'under_review', 'approved', 'superseded'];

const MARINE_LOBS = new Set(['Marine Cargo', 'Marine Hull']);

// Pull all the data needed to render an FSR from scratch.
//
// Returns: { claim, lossSheet, lossItems, marineSheet, marineItems, ewClaim,
//            ila, narrative, template, signerHint }
//
// Throws on missing claim or no template for (company, lob).
//
// @param supabase     supabase-js client (service role for server-side use)
// @param claimId      bigint claim id
// @param company      'NISLA' | 'Acuere' (defaults to claim.company)
// @param lob          'Fire' | 'Marine Cargo' | 'Extended Warranty' | ...
//                     (defaults to claim.lob)
// @param templateName 'Default' | 'Production' | 'ILA' | <custom>
//                     (defaults to 'Production' which is the real-sample-
//                     aligned template seeded by the
//                     20260501000000_seed_real_sample_templates migration —
//                     callers wanting the older shape can pass 'Default')
export async function loadFsrContext(supabase, { claimId, company, lob, templateName = 'Production' }) {
  // Claim
  const { data: claim, error: claimErr } = await supabase
    .from('claims')
    .select('*')
    .eq('id', claimId)
    .single();
  if (claimErr || !claim) {
    throw new Error('Claim not found');
  }

  const resolvedLob = lob || claim.lob || 'Fire';
  const resolvedCompany = company || claim.company || 'NISLA';

  // ---- LOB-specific loss sheet ----
  let lossSheet = null;
  let lossItems = [];
  let marineSheet = null;
  let marineItems = [];
  let ewClaim = null;

  if (MARINE_LOBS.has(resolvedLob)) {
    const { data: ms } = await supabase
      .from('marine_loss_sheets')
      .select('*')
      .eq('claim_id', claimId)
      .maybeSingle();
    marineSheet = ms || null;
    if (ms) {
      const { data: items } = await supabase
        .from('marine_loss_sheet_items')
        .select('*')
        .eq('marine_sheet_id', ms.id)
        .order('item_no', { ascending: true });
      marineItems = items || [];
    }
  } else if (resolvedLob === 'Extended Warranty') {
    const { data: ew } = await supabase
      .from('ew_vehicle_claims')
      .select('*')
      .eq('claim_id', claimId)
      .maybeSingle();
    ewClaim = ew || null;
  } else {
    // Fire / other — original behaviour
    const { data: ls } = await supabase
      .from('loss_sheets')
      .select('*')
      .eq('claim_id', claimId)
      .maybeSingle();
    lossSheet = ls || null;
    if (ls) {
      const { data: items } = await supabase
        .from('loss_sheet_items')
        .select('*')
        .eq('loss_sheet_id', ls.id)
        .order('item_no', { ascending: true });
      lossItems = items || [];
    }
  }

  // ---- Latest ILA submission's draft ----
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

  // ---- Narrative drafts: pulled from the latest claim_fsr_drafts.narrative_jsonb ----
  const { data: latestDraft } = await supabase
    .from('claim_fsr_drafts')
    .select('narrative_jsonb')
    .eq('claim_id', claimId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const narrative = latestDraft?.narrative_jsonb || null;

  // ---- Template (company × lob × template_name) ----
  // Falls back through 'Production' → 'Default' → any active template
  // when the requested template_name doesn't exist.
  const candidates = Array.from(new Set([templateName, 'Production', 'Default'].filter(Boolean)));
  let template = null;
  for (const name of candidates) {
    const { data } = await supabase
      .from('fsr_lob_templates')
      .select('*')
      .eq('company', resolvedCompany)
      .eq('lob', resolvedLob)
      .eq('template_name', name)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) { template = data; break; }
  }
  // Last resort: any active template for this (company, lob)
  if (!template) {
    const { data } = await supabase
      .from('fsr_lob_templates')
      .select('*')
      .eq('company', resolvedCompany)
      .eq('lob', resolvedLob)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    template = data;
  }
  if (!template) {
    throw new Error(`No active FSR template for ${resolvedCompany} / ${resolvedLob}. Seed one in fsr_lob_templates.`);
  }

  return {
    claim,
    lossSheet,
    lossItems,
    marineSheet,
    marineItems,
    ewClaim,
    ila,
    narrative,
    template,
    signerHint: lastSubmission,
  };
}

// Sanitises a PUT body for claim_fsr_drafts.
//
// Editable fields:
//   draft_content   the rendered HTML (surveyor may edit before submit)
//   status          enum
//   approved_by     email
//   template_name   alternative variant the surveyor wants to render against
//   narrative_jsonb saved free-form prose (per-section blocks)
export function sanitiseDraftPayload(body = {}) {
  const out = {};
  if (body.draft_content !== undefined) {
    out.draft_content = typeof body.draft_content === 'string' ? body.draft_content : null;
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
  if (body.template_name !== undefined) {
    out.template_name = typeof body.template_name === 'string' ? body.template_name.trim() : null;
  }
  if (body.narrative_jsonb !== undefined) {
    if (body.narrative_jsonb !== null && typeof body.narrative_jsonb !== 'object') {
      throw new Error('narrative_jsonb must be an object or null');
    }
    out.narrative_jsonb = body.narrative_jsonb;
  }
  return out;
}

export { ALLOWED_STATUSES };

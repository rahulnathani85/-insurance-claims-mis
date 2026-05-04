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

// Soft-transition cutoff for the lifecycle gate. Claims with created_at
// strictly before this timestamp keep working via the legacy
// (company, lob, 'Production') fallback (with a Sentry warning); claims
// created on/after this go through the strict lifecycle gate.
//
// Updated to the migration timestamp on 2026-05-04 — see
// supabase/migrations/20260504173522_fsr_template_on_lifecycle.sql.
const LIFECYCLE_GATE_CUTOFF_AT = '2026-05-04T17:35:22Z';

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

  // ---- Lifecycle-driven FSR template resolution ------------------------------
  // For claims registered on/after LIFECYCLE_GATE_CUTOFF_AT, the FSR template
  // is selected via the resolved lifecycle template (claim_lifecycle →
  // lifecycle_templates.fsr_template_name). Pre-cutoff claims fall back to
  // the legacy (company, lob, 'Production') path with a Sentry warning.
  // The caller can also hard-override by passing a non-default templateName.
  // See resolveFsrTemplateName (exported below) for the full decision tree.
  const resolution = await resolveFsrTemplateName(supabase, claim, {
    requestedName: templateName,
  });
  // resolveFsrTemplateName throws on the strict-gate failure cases; if it
  // returned, we have a templateName to look up.
  templateName = resolution.templateName;

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
    // Provenance of the template selection — surfaced in the API response
    // so the UI can render a "lifecycle-driven" / "legacy fallback" /
    // "override" badge plus a Sentry-warning notice on the legacy path.
    templateSource: resolution.source,
    templateWarning: resolution.warning || null,
    lifecycleTemplateId: resolution.lifecycleTemplateId || null,
    lifecycleTemplateCode: resolution.lifecycleTemplateCode || null,
  };
}

// =============================================================================
// resolveFsrTemplateName
// =============================================================================
// Picks the right `fsr_lob_templates.template_name` for a claim, gated by
// the lifecycle engine. Decision tree:
//
//   1. Caller override — if templateName is explicitly something other than
//      'Production', use it as-is. Lets the existing UI "render against
//      template X" affordance keep working.
//
//   2. Lifecycle-driven — if the claim has a claim_lifecycle row whose
//      lifecycle_template has a non-null fsr_template_name, use that. This
//      is the post-cutoff happy path: the lifecycle resolver at registration
//      already accounted for client / LOB / portfolio, so the FSR template
//      inherits that decision automatically.
//
//   3. Legacy soft-transition — if the claim's created_at predates
//      LIFECYCLE_GATE_CUTOFF_AT, fall back to 'Production' with a warning
//      payload (the route logs this to Sentry). Pre-cutoff claims may not
//      have a lifecycle attached at all; we don't break them.
//
//   4. Strict gate — post-cutoff claims with no lifecycle (or a lifecycle
//      template missing fsr_template_name) throw a 409 with a code the UI
//      can match on to render an "Initialize lifecycle" CTA.
//
// Returns: { templateName, source: 'override'|'lifecycle'|'legacy',
//            warning?, lifecycleTemplateId?, lifecycleTemplateCode? }
// Throws:  Error with .statusCode=409 and .code in
//          ['LIFECYCLE_NOT_INITIALIZED', 'FSR_TEMPLATE_NOT_CONFIGURED']
// =============================================================================
export async function resolveFsrTemplateName(supabase, claim, { requestedName } = {}) {
  // 1. Caller override — anything that's not the default 'Production' is
  //    treated as a deliberate request for that variant.
  if (requestedName && requestedName !== 'Production') {
    return { templateName: requestedName, source: 'override' };
  }

  // 2. Lifecycle-driven path.
  let lifecycleRow = null;
  try {
    const { data: lc } = await supabase
      .from('claim_lifecycle')
      .select('id, template_id')
      .eq('claim_id', claim.id)
      .maybeSingle();
    lifecycleRow = lc || null;
  } catch (e) {
    // Schema not yet present (e.g. running tests on an old fixture). Treat
    // as "no lifecycle" — falls into the soft-transition or strict-gate
    // branches below.
    lifecycleRow = null;
  }

  if (lifecycleRow?.template_id) {
    const { data: tmpl } = await supabase
      .from('lifecycle_templates')
      .select('id, template_code, fsr_template_name')
      .eq('id', lifecycleRow.template_id)
      .maybeSingle();
    if (tmpl?.fsr_template_name) {
      return {
        templateName: tmpl.fsr_template_name,
        source: 'lifecycle',
        lifecycleTemplateId: tmpl.id,
        lifecycleTemplateCode: tmpl.template_code,
      };
    }
  }

  // 3. Soft transition for pre-cutoff claims.
  const isLegacy = claim.created_at && new Date(claim.created_at) < new Date(LIFECYCLE_GATE_CUTOFF_AT);
  if (isLegacy) {
    const warning = lifecycleRow
      ? `Lifecycle template ${lifecycleRow.template_id} has no fsr_template_name configured; falling back to legacy (company, lob, 'Production') for pre-cutoff claim ${claim.id}.`
      : `Claim ${claim.id} has no lifecycle initialized; falling back to legacy (company, lob, 'Production') because it pre-dates the lifecycle gate (${LIFECYCLE_GATE_CUTOFF_AT}).`;
    return {
      templateName: 'Production',
      source: 'legacy',
      warning,
    };
  }

  // 4. Strict gate for new claims.
  if (!lifecycleRow) {
    const e = new Error(
      'Initialize the lifecycle workflow before generating an FSR. ' +
      'Open the claim, attach a lifecycle template, then re-render.'
    );
    e.statusCode = 409;
    e.code = 'LIFECYCLE_NOT_INITIALIZED';
    throw e;
  }
  const e = new Error(
    `Lifecycle template (id=${lifecycleRow.template_id}) has no fsr_template_name configured. ` +
    'Update the lifecycle template (or contact admin) before generating an FSR.'
  );
  e.statusCode = 409;
  e.code = 'FSR_TEMPLATE_NOT_CONFIGURED';
  throw e;
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

export { ALLOWED_STATUSES, LIFECYCLE_GATE_CUTOFF_AT };

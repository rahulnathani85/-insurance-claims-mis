// =============================================================================
// /api/fsr-drafts/render
// =============================================================================
// Renders an FSR draft from a `fsr_lob_templates` row against the current
// state of the claim, the LOB-appropriate loss sheet, the latest ILA
// submission's draft, and any saved narrative_jsonb. Optionally persists
// the rendered HTML as a new (or updated) `claim_fsr_drafts` row.
//
// This is the **template-based** path. The legacy /api/ai/generate-fsr
// route uses pure-AI HTML generation (system prompt → entire FSR HTML)
// and stays as-is for callers that don't want a template.
//
// POST body:
//   {
//     claim_id:       BIGINT       (required)
//     template_name?: string       (default 'Production' — falls back to 'Default' / any active)
//     company?:       'NISLA' | 'Acuere'  (default claim.company)
//     lob?:           string                (default claim.lob)
//     narrative_jsonb?: object              (overrides the saved narrative for this render only;
//                                             pass with save=true to also persist)
//     user_email?:    string                (for audit log)
//     save?:          boolean               (default true; false = preview-only)
//   }
//
// Response (200):
//   {
//     ok:      true,
//     draft:   { id, claim_id, version_number, template_name, status, ... } | null,
//     html:    "<!DOCTYPE html>...",
//     template: { id, name, version, company, lob },
//     missing_placeholders: ['narrative.observations', ...]
//   }
//
// Errors:
//   400  bad request (missing claim_id, invalid status etc)
//   404  claim or template not found
//   409  latest draft is approved/superseded; create a new one explicitly
//   500  unexpected
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  loadFsrContext,
  buildContext,
  substitute,
  sanitiseDraftPayload,
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
  const save = body?.save !== false;  // default true

  // Flag-1 hybrid versioning: by default we update the latest open draft
  // in place (cheap iteration). When the surveyor wants an explicit
  // checkpoint — e.g. "snapshot before sending to the insurer for
  // review" — they pass force_new_version=true and we always insert a
  // new row with version_number = max + 1, regardless of whether the
  // current latest draft is open.
  const forceNewVersion = body?.force_new_version === true;

  // Surveyor (signer) hint for the {{signer.*}} block. Looked up from the
  // surveyors table via user_email; falls back to email-only if no row.
  let signer = null;
  if (body?.user_email) {
    const { data } = await supabaseAdmin
      .from('surveyors')
      .select('id, name, email, license_number, license_category, license_expiry_date')
      .ilike('email', String(body.user_email))
      .maybeSingle();
    signer = data || { email: body.user_email };
  }

  // ---- Load full context ----
  let ctx;
  try {
    ctx = await loadFsrContext(supabaseAdmin, {
      claimId,
      company: body?.company,
      lob: body?.lob,
      templateName: body?.template_name || 'Production',
    });
  } catch (e) {
    if (/not found/i.test(e.message)) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    captureError(e, { area: 'fsr-render-load', claim_id: claimId });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  const { claim, lossSheet, lossItems, marineSheet, marineItems, ewClaim, ila, narrative: savedNarrative, template } = ctx;

  // Caller-supplied narrative wins over the persisted one for this render.
  const narrative = body?.narrative_jsonb && typeof body.narrative_jsonb === 'object'
    ? body.narrative_jsonb
    : savedNarrative;

  // ---- Build the placeholder context ----
  const renderCtx = buildContext({
    claim,
    lossSheet,
    lossItems,
    marineSheet,
    marineItems,
    ewClaim,
    ila,
    signer,
    narrative,
    company: body?.company || claim.company || 'NISLA',
  });

  // ---- Render ----
  const html = substitute(template.body_html, renderCtx);

  // ---- Detect placeholders that fell back to "(blank)" ----
  const missing = detectMissingPlaceholders(template.body_html, renderCtx);

  // ---- Optional persistence ----
  let draft = null;
  if (save) {
    try {
      draft = await upsertDraft({
        claimId: claim.id,
        lob: claim.lob,
        templateName: template.template_name,
        narrative,
        html,
        forceNewVersion,
      });
    } catch (e) {
      // Status 409 ("approved/superseded") is expected — surface it directly.
      if (e?.statusCode === 409) {
        return NextResponse.json({ error: e.message }, { status: 409 });
      }
      captureError(e, { area: 'fsr-render-upsert', claim_id: claim.id });
      return NextResponse.json({ error: e.message || 'Could not persist draft' }, { status: 500 });
    }

    // Audit log — render is a meaningful event because it produces the
    // candidate document the surveyor will sign.
    try {
      await supabaseAdmin.from('activity_log').insert([{
        action: 'fsr_rendered',
        entity_type: 'claim',
        entity_id: String(claim.id),
        claim_id: claim.id,
        ref_number: claim.ref_number,
        user_email: signer?.email || body?.user_email || null,
        user_name: signer?.name || null,
        company: claim.company || 'NISLA',
        details: JSON.stringify({
          draft_id: draft.id,
          version: draft.version_number,
          template_id: template.id,
          template_name: template.template_name,
          template_version: template.version,
          missing_placeholders_count: missing.length,
        }),
      }]);
    } catch (e) {
      captureError(e, { area: 'fsr-render-audit', claim_id: claim.id, draft_id: draft?.id });
      // Non-fatal — render succeeded; audit failure shouldn't 500 the request.
    }
  }

  return NextResponse.json({
    ok: true,
    draft,
    html,
    template: {
      id: template.id,
      name: template.template_name,
      version: template.version,
      company: template.company,
      lob: template.lob,
    },
    missing_placeholders: missing,
  });
}

// -----------------------------------------------------------------------------
// upsertDraft — find the latest non-approved draft for the claim and update
// it, or insert a new one at version_number = max + 1.
//
// forceNewVersion=true overrides the in-place-update path. Used when the
// surveyor wants an explicit checkpoint before sending to the insurer
// for review. Pre-existing approved/superseded drafts still 409 — that
// path is reserved for a deliberate "supersede the approved version"
// flow which doesn't exist yet.
// -----------------------------------------------------------------------------
async function upsertDraft({ claimId, lob, templateName, narrative, html, forceNewVersion = false }) {
  // Find the most recent draft for this claim
  const { data: latest } = await supabaseAdmin
    .from('claim_fsr_drafts')
    .select('id, version_number, status')
    .eq('claim_id', claimId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest && latest.status === 'draft' && !forceNewVersion) {
    // Update in place — surveyor is iterating on the same draft
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
    if (error) throw error;
    return data;
  }

  if (latest && (latest.status === 'approved' || latest.status === 'superseded')) {
    // Approved drafts are immutable — caller must explicitly create a new
    // version. Encode the 409 via a tagged error. (Even forceNewVersion
    // doesn't bypass this: superseding an approved draft is a deliberate
    // workflow that requires the previous version to also be marked
    // superseded — out of scope for this route.)
    const e = new Error(`Latest draft is ${latest.status}; supersede it explicitly before re-rendering`);
    e.statusCode = 409;
    throw e;
  }

  // No prior draft, or under_review (locked), or forceNewVersion=true: insert a new row.
  const nextVersion = latest ? latest.version_number + 1 : 1;
  const { data, error } = await supabaseAdmin
    .from('claim_fsr_drafts')
    .insert([{
      claim_id: claimId,
      lob: lob || null,
      draft_content: html,
      template_name: templateName,
      narrative_jsonb: narrative ?? null,
      status: 'draft',
      version_number: nextVersion,
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

// -----------------------------------------------------------------------------
// detectMissingPlaceholders — walks the template body, resolves each
// {{path}} occurrence against the context, and returns the unique set of
// paths that resolved to empty/null/undefined.
//
// Used by the UI to surface a "fields still to fill" badge after render.
// Excludes a few cosmetic always-present keys (date_today, signer.*) from
// the missing list when their fallback value is acceptable.
// -----------------------------------------------------------------------------
function detectMissingPlaceholders(body, ctx) {
  if (typeof body !== 'string') return [];
  const seen = new Set();
  const missing = new Set();
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const path = m[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const v = resolvePath(ctx, path);
    if (v === undefined || v === null || v === '') {
      missing.add(path);
    }
  }
  return Array.from(missing).sort();
}

function resolvePath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[key];
  }, obj);
}

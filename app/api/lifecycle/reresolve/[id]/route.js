// =============================================================================
// /app/api/lifecycle/reresolve/[id]/route.js
// =============================================================================
// POST — re-resolve template for a lifecycle. Used when claim attributes
//        change (e.g. size-band shifts from Medium to High Value after
//        assessment) and a different template should now apply.
//
// The engine preserves already-completed stages and only applies the new
// template's remaining stages.
// =============================================================================

import { resolveTemplate, materializeStages } from '@/lib/lifecycleEngine';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(request, { params }) {
  try {
    const body = await request.json();
    const id = parseInt(params.id, 10);

    const { data: lc } = await supabaseAdmin
      .from('claim_lifecycle').select('*').eq('id', id).single();
    if (!lc) return Response.json({ error: 'lifecycle not found' }, { status: 404 });

    const newAttrs = { ...(lc.resolved_from || {}), ...(body.updated_attributes || {}) };
    const newTemplate = await resolveTemplate(newAttrs);

    if (newTemplate.id === lc.template_id) {
      return Response.json({ ok: true, unchanged: true });
    }

    const newStages = await materializeStages(newTemplate);

    // Identify stages by stage_code that already exist (completed) on the claim.
    const { data: existing } = await supabaseAdmin
      .from('claim_lifecycle_stages').select('*')
      .eq('claim_lifecycle_id', id);

    const existingMap = new Map((existing || []).map(s => [s.stage_code, s]));

    // For each new stage, either keep the existing row (if same stage_code exists
    // and is completed) or insert a fresh not_started row.
    for (const ns of newStages) {
      const ex = existingMap.get(ns.stage_code);
      if (ex) continue; // already on the claim
      await supabaseAdmin
        .from('claim_lifecycle_stages').insert({
          claim_lifecycle_id: id,
          template_stage_id: ns.id,
          stage_code: ns.stage_code,
          stage_name: ns.stage_name,
          universal_phase: ns.universal_phase,
          sequence_number: ns.sequence_number,
          status: 'not_started',
        });
    }

    // Mark stages not in new template as 'skipped' (they are no longer applicable)
    const newCodes = new Set(newStages.map(s => s.stage_code));
    for (const ex of (existing || [])) {
      if (!newCodes.has(ex.stage_code) && ex.status === 'not_started') {
        await supabaseAdmin
          .from('claim_lifecycle_stages')
          .update({ status: 'skipped' })
          .eq('id', ex.id);
      }
    }

    // Update lifecycle's template pointer
    await supabaseAdmin
      .from('claim_lifecycle')
      .update({
        template_id: newTemplate.id,
        template_version_at_resolve: newTemplate.version,
        resolved_from: newAttrs,
      })
      .eq('id', id);

    return Response.json({ ok: true, new_template: newTemplate.template_code });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}

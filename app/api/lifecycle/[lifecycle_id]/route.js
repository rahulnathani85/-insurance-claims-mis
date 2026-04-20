// =============================================================================
// /app/api/lifecycle/[lifecycle_id]/route.js
// =============================================================================
// GET    — fetch the full lifecycle state for a claim (phases + stages + items + subtasks)
//          Used by the Claim Detail page to render the lifecycle viewer.
// DELETE — detach the lifecycle from its claim. Wipes all claim_lifecycle_*
//          rows for this lifecycle and flips uses_lifecycle_engine back to
//          false on the target claim. Use this when a wrong template was
//          attached and you want to reassign a different one via /api/lifecycle/attach.
// =============================================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request, { params }) {
  const id = parseInt(params.lifecycle_id, 10);

  try {
    const [lifecycleRes, phasesRes, stagesRes, itemsRes, templateRes] = await Promise.all([
      supabaseAdmin.from('claim_lifecycle').select('*').eq('id', id).single(),
      supabaseAdmin.from('claim_lifecycle_phases').select('*').eq('claim_lifecycle_id', id).order('universal_phase'),
      supabaseAdmin.from('claim_lifecycle_stages').select('*').eq('claim_lifecycle_id', id).order('sequence_number'),
      supabaseAdmin.from('claim_lifecycle_items').select('*').eq('claim_lifecycle_id', id).order('created_at'),
      supabaseAdmin.from('claim_lifecycle').select('template_id').eq('id', id).single()
        .then(async r => r.data ? supabaseAdmin.from('lifecycle_templates').select('*').eq('id', r.data.template_id).single() : null),
    ]);

    if (lifecycleRes.error) return Response.json({ error: lifecycleRes.error.message }, { status: 404 });

    // Pull sub-tasks for any stages that have them
    const stageIds = (stagesRes.data || []).map(s => s.id);
    const { data: subtasks } = stageIds.length
      ? await supabaseAdmin.from('claim_lifecycle_subtasks').select('*').in('claim_stage_id', stageIds)
      : { data: [] };

    return Response.json({
      lifecycle: lifecycleRes.data,
      template: templateRes?.data,
      phases: phasesRes.data,
      stages: stagesRes.data,
      subtasks: subtasks || [],
      items: itemsRes.data,
    });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const id = parseInt(params.lifecycle_id, 10);
  if (!Number.isFinite(id)) {
    return Response.json({ error: 'Invalid lifecycle_id' }, { status: 400 });
  }

  let userEmail = null;
  try {
    const body = await request.json().catch(() => ({}));
    userEmail = body?.user_email || null;
  } catch { /* no body is fine */ }

  try {
    // 1. Look up the lifecycle first so we know which claim to un-flag.
    const { data: lc, error: lcErr } = await supabaseAdmin
      .from('claim_lifecycle')
      .select('id, claim_id, ew_claim_id, template_id')
      .eq('id', id)
      .maybeSingle();

    if (lcErr) throw lcErr;
    if (!lc) {
      return Response.json({ error: `Lifecycle ${id} not found` }, { status: 404 });
    }

    // 2. Pull stage ids so we can wipe the subtasks that reference them. The
    //    subtasks table has no FK to claim_lifecycle_id directly — it's keyed
    //    on claim_stage_id — so we do the join manually.
    const { data: stages } = await supabaseAdmin
      .from('claim_lifecycle_stages')
      .select('id')
      .eq('claim_lifecycle_id', id);

    const stageIds = (stages || []).map(s => s.id);

    // 3. Cascade-delete in reverse dependency order.
    if (stageIds.length > 0) {
      await supabaseAdmin
        .from('claim_lifecycle_subtasks')
        .delete()
        .in('claim_stage_id', stageIds);
    }

    await supabaseAdmin.from('claim_lifecycle_items').delete().eq('claim_lifecycle_id', id);
    await supabaseAdmin.from('claim_lifecycle_stages').delete().eq('claim_lifecycle_id', id);
    await supabaseAdmin.from('claim_lifecycle_phases').delete().eq('claim_lifecycle_id', id);

    // 4. Audit trail — best effort, don't fail the detach if audit insert fails.
    try {
      await supabaseAdmin.from('claim_lifecycle_audit').insert([{
        claim_lifecycle_id: id,
        event_type: 'lifecycle_detached',
        payload: { template_id: lc.template_id, claim_id: lc.claim_id, ew_claim_id: lc.ew_claim_id },
        actor_email: userEmail,
      }]);
    } catch { /* audit table may not exist on older migrations */ }

    // 5. Delete the lifecycle row itself
    const { error: delErr } = await supabaseAdmin
      .from('claim_lifecycle')
      .delete()
      .eq('id', id);
    if (delErr) throw delErr;

    // 6. Flip uses_lifecycle_engine back to false on the target claim so the
    //    bulk-attach page and claim detail page show it as reattachable again.
    if (lc.claim_id) {
      await supabaseAdmin
        .from('claims')
        .update({ uses_lifecycle_engine: false })
        .eq('id', lc.claim_id);
    } else if (lc.ew_claim_id) {
      await supabaseAdmin
        .from('ew_vehicle_claims')
        .update({ uses_lifecycle_engine: false })
        .eq('id', lc.ew_claim_id);
    }

    return Response.json({
      ok: true,
      detached_lifecycle_id: id,
      claim_id: lc.claim_id,
      ew_claim_id: lc.ew_claim_id,
    });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}

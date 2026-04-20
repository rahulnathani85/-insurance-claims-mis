// =============================================================================
// /app/api/lifecycle/[lifecycle_id]/route.js
// =============================================================================
// GET — fetch the full lifecycle state for a claim (phases + stages + items + subtasks)
//       Used by the Claim Detail page to render the lifecycle viewer.
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

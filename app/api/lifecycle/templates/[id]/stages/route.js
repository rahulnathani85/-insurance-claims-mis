// =============================================================================
// /app/api/lifecycle/templates/[id]/stages/route.js
// =============================================================================
// GET  — list stages for a template
// POST — add a stage to a template
// =============================================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request, { params }) {
  const { data, error } = await supabaseAdmin
    .from('lifecycle_template_stages').select('*')
    .eq('template_id', parseInt(params.id, 10))
    .eq('is_active', true)
    .order('sequence_number');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ stages: data });
}

export async function POST(request, { params }) {
  const body = await request.json();
  const { data, error } = await supabaseAdmin
    .from('lifecycle_template_stages')
    .insert({
      template_id: parseInt(params.id, 10),
      stage_code: body.stage_code,
      stage_name: body.stage_name,
      description: body.description,
      universal_phase: body.universal_phase,
      sequence_number: body.sequence_number,
      sequence_within_phase: body.sequence_within_phase || 1,
      firm_tat_hours: body.firm_tat_hours,
      insurer_tat_hours: body.insurer_tat_hours,
      firm_tat_anchor: body.firm_tat_anchor || 'previous_stage_complete',
      insurer_tat_anchor: body.insurer_tat_anchor || 'intimation',
      owner_role: body.owner_role,
      completion_trigger: body.completion_trigger,
      required_artifacts: body.required_artifacts,
      branching_active: body.branching_active || false,
      subtasks_active: body.subtasks_active || false,
      subtask_completion_rule: body.subtask_completion_rule || 'all',
      subtask_min_count: body.subtask_min_count,
      delta_operation: body.delta_operation || 'add',
      is_skippable: body.is_skippable || false,
      skip_condition: body.skip_condition,
    })
    .select().single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ stage: data });
}

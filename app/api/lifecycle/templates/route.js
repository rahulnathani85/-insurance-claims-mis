// =============================================================================
// /app/api/lifecycle/templates/route.js
// =============================================================================
// GET    — list all templates (admin UI)
// POST   — create a new template (admin UI)
// =============================================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request) {
  const { data, error } = await supabaseAdmin
    .from('lifecycle_templates')
    .select('*, parent:lifecycle_templates!parent_template_id(template_code, template_name)')
    .eq('is_active', true)
    .order('priority', { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ templates: data });
}

export async function POST(request) {
  const body = await request.json();
  const { data, error } = await supabaseAdmin
    .from('lifecycle_templates')
    .insert({
      template_code: body.template_code,
      template_name: body.template_name,
      description: body.description,
      resolution_type: body.resolution_type || 'full_list',
      parent_template_id: body.parent_template_id || null,
      match_lob: body.match_lob || null,
      match_policy_type: body.match_policy_type || null,
      match_cause_of_loss: body.match_cause_of_loss || null,
      match_subject_matter: body.match_subject_matter || null,
      match_portfolio: body.match_portfolio || null,
      match_client: body.match_client || null,
      match_size_band: body.match_size_band || null,
      match_nature: body.match_nature || null,
      match_appointment_src: body.match_appointment_src || null,
      branching_enabled: body.branching_enabled || false,
      subtasks_enabled: body.subtasks_enabled || false,
      time_rules_enabled: body.time_rules_enabled || false,
      priority: body.priority || 100,
      created_by: body.user_email,
    })
    .select().single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ template: data });
}

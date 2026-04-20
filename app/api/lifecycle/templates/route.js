// =============================================================================
// /app/api/lifecycle/templates/route.js
// =============================================================================
// GET    — list templates (optionally filter by is_active=true|false via query)
// POST   — create a new template (admin UI)
// PUT    — update template fields (metadata + feature toggles + is_active)
// DELETE — permanently remove a template (blocks if any claims use it)
// =============================================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const isActiveParam = searchParams.get('is_active');

  let query = supabaseAdmin
    .from('lifecycle_templates')
    .select('*, parent:lifecycle_templates!parent_template_id(template_code, template_name)')
    .order('priority', { ascending: false });

  if (isActiveParam === 'true')  query = query.eq('is_active', true);
  if (isActiveParam === 'false') query = query.eq('is_active', false);
  // Otherwise (no param) → return all templates. The /lifecycle-templates list
  // page needs this so admin can see & reactivate inactive templates.

  const { data, error } = await query;
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
      is_active: body.is_active !== undefined ? body.is_active : true,
      created_by: body.created_by || body.user_email || null,
    })
    .select().single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ template: data });
}

// PUT — accepts id in body OR in ?id= query string. Only whitelisted columns
// are updatable; anything else is silently ignored so clients can't touch
// system fields (version, created_at).
export async function PUT(request) {
  const body = await request.json().catch(() => ({}));
  const { searchParams } = new URL(request.url);
  const id = body.id || searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const ALLOWED = [
    'template_name', 'description',
    'match_lob', 'match_policy_type', 'match_cause_of_loss', 'match_subject_matter',
    'match_portfolio', 'match_client', 'match_size_band', 'match_nature', 'match_appointment_src',
    'branching_enabled', 'subtasks_enabled', 'time_rules_enabled',
    'priority', 'is_active',
  ];
  const updates = {};
  for (const k of ALLOWED) {
    if (k in body) updates[k] = body[k];
  }
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No updatable fields provided' }, { status: 400 });
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('lifecycle_templates')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ template: data });
}

// DELETE — blocks if any live claim_lifecycle rows reference this template.
// If blocked, admin must detach those claims first (or Deactivate instead).
export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  let id = searchParams.get('id');
  if (!id) {
    const body = await request.json().catch(() => ({}));
    id = body?.id;
  }
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  // Guard: don't delete a template any claim is using
  const { count: inUse, error: countErr } = await supabaseAdmin
    .from('claim_lifecycle')
    .select('*', { count: 'exact', head: true })
    .eq('template_id', id);
  if (countErr) return Response.json({ error: countErr.message }, { status: 500 });
  if ((inUse || 0) > 0) {
    return Response.json(
      { error: `Cannot delete — ${inUse} claim(s) are attached to this template. Deactivate it instead, or detach those claims first.` },
      { status: 409 }
    );
  }

  // Delete cascades to lifecycle_template_stages + lifecycle_template_default_items
  // via FK ON DELETE CASCADE.
  const { error } = await supabaseAdmin
    .from('lifecycle_templates')
    .delete()
    .eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ success: true });
}

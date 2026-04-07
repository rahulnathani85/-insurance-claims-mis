import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// PUT - Update a workflow stage (status, assignment, comments, dates)
export async function PUT(request, { params }) {
  const { id } = params;
  const body = await request.json();

  const updates = {};
  if (body.status !== undefined) updates.status = body.status;
  if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to;
  if (body.assigned_by !== undefined) updates.assigned_by = body.assigned_by;
  if (body.comments !== undefined) updates.comments = body.comments;
  if (body.due_date !== undefined) updates.due_date = body.due_date;
  updates.updated_at = new Date().toISOString();

  // If marking as completed, set completed_date and check TAT
  if (body.status === 'Completed') {
    updates.completed_date = new Date().toISOString();

    // Get the current stage to check TAT
    const { data: stage } = await supabase.from('claim_workflow').select('*').eq('id', id).single();
    if (stage && stage.due_date) {
      const dueDate = new Date(stage.due_date);
      const now = new Date();
      updates.is_tat_breached = now > dueDate;
    }

    // If this stage has dependent stages (stage_X references), calculate their due dates
    if (stage) {
      const { data: dependentStages } = await supabase
        .from('claim_workflow')
        .select('*')
        .eq('claim_id', stage.claim_id)
        .like('tat_from', `stage_${stage.stage_number}`);

      if (dependentStages && dependentStages.length > 0) {
        for (const dep of dependentStages) {
          if (dep.tat_days) {
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + dep.tat_days);
            await supabase.from('claim_workflow')
              .update({ due_date: dueDate.toISOString().split('T')[0], updated_at: new Date().toISOString() })
              .eq('id', dep.id);
          }
        }
      }
    }
  }

  // If marking as In Progress
  if (body.status === 'In Progress') {
    // Check TAT breach for pending items
    const { data: stage } = await supabase.from('claim_workflow').select('*').eq('id', id).single();
    if (stage && stage.due_date) {
      const dueDate = new Date(stage.due_date);
      const now = new Date();
      if (now > dueDate) updates.is_tat_breached = true;
    }
  }

  const { data, error } = await supabase.from('claim_workflow').update(updates).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Log history if provided
  if (body._log_action) {
    await supabase.from('claim_workflow_history').insert([{
      workflow_id: id,
      claim_id: data.claim_id,
      action: body._log_action,
      user_email: body._log_user_email,
      user_name: body._log_user_name,
      details: body._log_details,
      old_value: body._log_old_value,
      new_value: body._log_new_value,
    }]);
  }

  return NextResponse.json(data);
}

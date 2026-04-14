import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';

// PUT - Update assignment status/details (enhanced for team assignments)
export async function PUT(request, { params }) {
  const { id } = params;
  const body = await request.json();

  const updates = {};
  if (body.status !== undefined) updates.status = body.status;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.due_date !== undefined) updates.due_date = body.due_date;
  if (body.role !== undefined) updates.role = body.role;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.assignment_type !== undefined) updates.assignment_type = body.assignment_type;
  if (body.assignment_basis !== undefined) updates.assignment_basis = body.assignment_basis;
  if (body.location_of_loss !== undefined) updates.location_of_loss = body.location_of_loss;
  if (body.target_inspection_date !== undefined) updates.target_inspection_date = body.target_inspection_date || null;
  if (body.target_report_date !== undefined) updates.target_report_date = body.target_report_date || null;

  // Reassignment: require reason when changing assigned_to
  if (body.assigned_to !== undefined) {
    updates.assigned_to = body.assigned_to;
    updates.assigned_to_name = body.assigned_to_name || null;
    if (body.reassignment_reason) {
      updates.reassignment_reason = body.reassignment_reason;
      updates.status = 'Reassigned';
    }
  }

  if (body.status === 'Completed') updates.completed_date = new Date().toISOString().split('T')[0];
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('claim_assignments')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

// DELETE - Remove assignment
export async function DELETE(request, { params }) {
  const { id } = params;
  const { error } = await supabaseAdmin
    .from('claim_assignments')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

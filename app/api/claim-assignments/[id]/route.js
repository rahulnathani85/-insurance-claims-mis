import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// PUT - Update assignment status/details
export async function PUT(request, { params }) {
  const { id } = params;
  const body = await request.json();

  const updates = {};
  if (body.status !== undefined) updates.status = body.status;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.due_date !== undefined) updates.due_date = body.due_date;
  if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to;
  if (body.role !== undefined) updates.role = body.role;
  if (body.status === 'Completed') updates.completed_date = new Date().toISOString().split('T')[0];
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
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
  const { error } = await supabase
    .from('claim_assignments')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

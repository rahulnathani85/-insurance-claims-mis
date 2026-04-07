import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET - List assignments with optional filters
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claimId = searchParams.get('claim_id');
  const assignedTo = searchParams.get('assigned_to');
  const status = searchParams.get('status');
  const company = searchParams.get('company');

  let query = supabase
    .from('claim_assignments')
    .select('*')
    .order('created_at', { ascending: false });

  if (claimId) query = query.eq('claim_id', claimId);
  if (assignedTo) query = query.eq('assigned_to', assignedTo);
  if (status) query = query.eq('status', status);
  if (company) query = query.eq('company', company);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST - Create assignment
export async function POST(request) {
  const body = await request.json();

  if (!body.claim_id || !body.assigned_to) {
    return NextResponse.json({ error: 'claim_id and assigned_to are required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('claim_assignments')
    .insert([{
      claim_id: body.claim_id,
      assigned_to: body.assigned_to,
      assigned_by: body.assigned_by,
      role: body.role || 'Surveyor',
      status: 'Assigned',
      notes: body.notes,
      assigned_date: body.assigned_date || new Date().toISOString().split('T')[0],
      due_date: body.due_date,
      company: body.company || 'NISLA',
    }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

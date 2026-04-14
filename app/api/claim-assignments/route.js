import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';

// GET - List assignments with optional filters + workload mode
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claimId = searchParams.get('claim_id');
  const assignedTo = searchParams.get('assigned_to');
  const status = searchParams.get('status');
  const company = searchParams.get('company');
  const assignmentType = searchParams.get('assignment_type');
  const workload = searchParams.get('workload');

  // Workload mode: return active claim counts per user
  if (workload === 'true') {
    const { data, error } = await supabase
      .from('claim_assignments')
      .select('assigned_to, assigned_to_name, status')
      .neq('status', 'Completed');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Group by assigned_to
    const workloadMap = {};
    (data || []).forEach(a => {
      if (!a.assigned_to) return;
      if (!workloadMap[a.assigned_to]) {
        workloadMap[a.assigned_to] = { email: a.assigned_to, name: a.assigned_to_name || a.assigned_to, active: 0, in_progress: 0, assigned: 0 };
      }
      workloadMap[a.assigned_to].active++;
      if (a.status === 'In Progress') workloadMap[a.assigned_to].in_progress++;
      if (a.status === 'Assigned') workloadMap[a.assigned_to].assigned++;
    });

    // Also get completed counts for rate calculation
    const { data: allData } = await supabase.from('claim_assignments').select('assigned_to, status');
    const totalMap = {};
    (allData || []).forEach(a => {
      if (!a.assigned_to) return;
      if (!totalMap[a.assigned_to]) totalMap[a.assigned_to] = { total: 0, completed: 0 };
      totalMap[a.assigned_to].total++;
      if (a.status === 'Completed') totalMap[a.assigned_to].completed++;
    });

    const result = Object.values(workloadMap).map(w => ({
      ...w,
      total: totalMap[w.email]?.total || 0,
      completed: totalMap[w.email]?.completed || 0,
      completion_rate: totalMap[w.email]?.total ? Math.round((totalMap[w.email].completed / totalMap[w.email].total) * 100) : 0,
    })).sort((a, b) => b.active - a.active);

    return NextResponse.json(result);
  }

  let query = supabase
    .from('claim_assignments')
    .select('*')
    .order('created_at', { ascending: false });

  if (claimId) query = query.eq('claim_id', claimId);
  if (assignedTo) query = query.eq('assigned_to', assignedTo);
  if (status) query = query.eq('status', status);
  if (company) query = query.eq('company', company);
  if (assignmentType) query = query.eq('assignment_type', assignmentType);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST - Create assignment (supports team assignment fields)
export async function POST(request) {
  const body = await request.json();

  if (!body.claim_id || !body.assigned_to) {
    return NextResponse.json({ error: 'claim_id and assigned_to are required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('claim_assignments')
    .insert([{
      claim_id: body.claim_id,
      assigned_to: body.assigned_to,
      assigned_to_name: body.assigned_to_name || null,
      assigned_by: body.assigned_by,
      role: body.role || 'Surveyor',
      assignment_type: body.assignment_type || 'general',
      priority: body.priority || 'Normal',
      assignment_basis: body.assignment_basis || null,
      location_of_loss: body.location_of_loss || null,
      target_inspection_date: body.target_inspection_date || null,
      target_report_date: body.target_report_date || null,
      status: 'Assigned',
      notes: body.notes || null,
      assigned_date: body.assigned_date || new Date().toISOString().split('T')[0],
      due_date: body.due_date || null,
      company: body.company || 'NISLA',
    }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

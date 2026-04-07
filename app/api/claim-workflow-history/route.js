import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claimId = searchParams.get('claim_id');
  const workflowId = searchParams.get('workflow_id');

  let query = supabase.from('claim_workflow_history').select('*').order('created_at', { ascending: false });

  if (claimId) query = query.eq('claim_id', claimId);
  if (workflowId) query = query.eq('workflow_id', workflowId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request) {
  const body = await request.json();
  const { data, error } = await supabase.from('claim_workflow_history').insert([body]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

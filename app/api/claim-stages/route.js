import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET - Get stages for a claim
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claimId = searchParams.get('claim_id');

  if (!claimId) {
    return NextResponse.json({ error: 'claim_id is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('claim_stages')
    .select('*')
    .eq('claim_id', claimId)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST - Add a stage to a claim
export async function POST(request) {
  const body = await request.json();

  if (!body.claim_id || !body.stage) {
    return NextResponse.json({ error: 'claim_id and stage are required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('claim_stages')
    .insert([{
      claim_id: body.claim_id,
      stage: body.stage,
      stage_date: body.stage_date || new Date().toISOString().split('T')[0],
      notes: body.notes || null,
      updated_by: body.updated_by || null,
    }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claimId = searchParams.get('claim_id');
  const status = searchParams.get('status');
  const company = searchParams.get('company');

  let query = supabase.from('claim_reminders').select('*').order('due_date', { ascending: true });
  if (claimId) query = query.eq('claim_id', claimId);
  if (status) query = query.eq('status', status);
  if (company && company !== 'All') query = query.eq('company', company);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request) {
  const body = await request.json();
  const { data, error } = await supabase.from('claim_reminders').insert([body]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

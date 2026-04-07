import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let query = supabase.from('brokers').select('*').order('broker_name');
  const company = searchParams.get('company');
  if (company && company !== 'All') query = query.eq('company', company);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request) {
  const body = await request.json();
  if (!body.broker_name) return NextResponse.json({ error: 'Broker name is required' }, { status: 400 });
  const { data, error } = await supabase.from('brokers').insert([body]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

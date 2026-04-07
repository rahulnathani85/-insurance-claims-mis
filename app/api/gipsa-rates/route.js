import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let query = supabase.from('gipsa_fee_schedule').select('*').order('lob').order('loss_range_min');

  const lob = searchParams.get('lob');
  if (lob) query = query.eq('lob', lob);

  const isCustom = searchParams.get('is_custom');
  if (isCustom !== null) query = query.eq('is_custom', isCustom === 'true');

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request) {
  const body = await request.json();
  body.is_custom = true;
  const { data, error } = await supabase.from('gipsa_fee_schedule').insert([body]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

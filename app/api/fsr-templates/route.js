import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company');

  let query = supabaseAdmin.from('fsr_templates').select('*').eq('is_active', true);
  if (company) query = query.eq('company', company);
  query = query.order('created_at', { ascending: true });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If company specified, return single template
  if (company && data && data.length > 0) return NextResponse.json(data[0]);
  return NextResponse.json(data || []);
}

export async function POST(request) {
  const body = await request.json();
  if (!body.company) return NextResponse.json({ error: 'company required' }, { status: 400 });

  const { data, error } = await supabaseAdmin.from('fsr_templates').insert([body]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(request) {
  const body = await request.json();
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { id, ...updates } = body;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin.from('fsr_templates').update(updates).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

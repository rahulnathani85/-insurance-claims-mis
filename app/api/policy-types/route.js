import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET() {
  const { data, error } = await supabase
    .from('policy_types')
    .select('*')
    .order('lob')
    .order('policy_type');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request) {
  const body = await request.json();
  if (!body.lob || !body.policy_type) {
    return NextResponse.json({ error: 'LOB and Policy Type are required' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('policy_types')
    .insert([{ lob: body.lob, policy_type: body.policy_type, description: body.description || null }])
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'This policy type already exists for the selected LOB' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });
  const body = await request.json();
  const { error } = await supabase.from('policy_types').update(body).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });
  const { error } = await supabase.from('policy_types').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

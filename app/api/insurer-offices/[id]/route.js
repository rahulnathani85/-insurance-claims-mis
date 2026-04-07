import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function POST(request, { params }) {
  const body = await request.json();
  body.insurer_id = parseInt(params.id);
  const { data, error } = await supabase.from('insurer_offices').insert([body]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}

export async function DELETE(request, { params }) {
  const { error } = await supabase.from('insurer_offices').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

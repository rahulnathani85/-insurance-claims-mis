import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function PUT(request, { params }) {
  const { id } = params;
  const body = await request.json();
  delete body.id;
  delete body.created_at;
  const { data, error } = await supabase.from('brokers').update(body).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(request, { params }) {
  const { id } = params;
  const { error } = await supabase.from('brokers').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

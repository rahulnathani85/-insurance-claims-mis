import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// NOTE: For POST, [id] is the insurer_id (parent).
// For PUT and DELETE, [id] is the office id itself.

export async function POST(request, { params }) {
  const body = await request.json();
  body.insurer_id = parseInt(params.id);
  const { data, error } = await supabase.from('insurer_offices').insert([body]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}

export async function PUT(request, { params }) {
  const body = await request.json();
  // Strip fields that should not be updated
  delete body.id;
  delete body.insurer_id;
  delete body.created_at;
  const { data, error } = await supabase
    .from('insurer_offices')
    .update(body)
    .eq('id', params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true, office: data });
}

export async function DELETE(request, { params }) {
  const { error } = await supabase.from('insurer_offices').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET - Get single template
export async function GET(request, { params }) {
  const { id } = params;
  const { data, error } = await supabase
    .from('document_templates')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

// PUT - Update template
export async function PUT(request, { params }) {
  const { id } = params;
  const body = await request.json();

  const updates = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.content !== undefined) updates.content = body.content;
  if (body.lob !== undefined) updates.lob = body.lob;
  if (body.type !== undefined) updates.type = body.type;
  if (body.is_default !== undefined) updates.is_default = body.is_default;
  if (body.is_active !== undefined) updates.is_active = body.is_active;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('document_templates')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

// DELETE - Soft delete template
export async function DELETE(request, { params }) {
  const { id } = params;
  const { error } = await supabase
    .from('document_templates')
    .update({ is_active: false })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

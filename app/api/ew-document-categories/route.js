import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// GET - List all active document categories
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('ew_document_categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

// POST - Add new category (admin)
export async function POST(request) {
  const body = await request.json();
  if (!body.name || !body.code || !body.subfolder_name) {
    return NextResponse.json({ error: 'name, code, and subfolder_name required' }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin.from('ew_document_categories').insert([body]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

// PUT - Update category (admin)
export async function PUT(request) {
  const body = await request.json();
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { id, ...updates } = body;
  const { data, error } = await supabaseAdmin.from('ew_document_categories').update(updates).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { sanitiseSiteVisitPayload } from '@/lib/siteVisits';

export async function GET(_request, { params }) {
  const { id } = params;
  const { data, error } = await supabaseAdmin
    .from('site_visits')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PUT(request, { params }) {
  const { id } = params;
  const body = await request.json();

  let updates;
  try {
    updates = sanitiseSiteVisitPayload(body, { skipUndefined: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('site_visits')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(_request, { params }) {
  const { id } = params;
  const { error } = await supabaseAdmin.from('site_visits').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  const { data, error } = await supabase
    .from('insurers')
    .select('*, insurer_offices(*)')
    .eq('id', params.id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ ...data, offices: data.insurer_offices || [] });
}

export async function PUT(request, { params }) {
  const body = await request.json();
  delete body.id;
  delete body.offices;
  delete body.insurer_offices;
  delete body.created_at;
  const { error } = await supabase.from('insurers').update(body).eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

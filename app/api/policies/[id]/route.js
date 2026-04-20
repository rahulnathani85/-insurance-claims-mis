import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// Mirror the whitelist used by POST /api/policies — keeps PUT safe against
// stale/extra fields that the frontend may attach (e.g. nested insurer_offices
// object, auto-extracted fields, etc.) which would otherwise trigger a
// Supabase "column ... does not exist" error on update.
const ALLOWED_POLICY_COLS = [
  'policy_number', 'insurer', 'insurer_office', 'insured_name', 'insured_address',
  'city', 'phone', 'email', 'lob', 'policy_type', 'sum_insured', 'premium',
  'start_date', 'end_date', 'policy_copy_url', 'company', 'risk_location',
  'coverage_amount', 'description', 'folder_path',
];

export async function PUT(request, { params }) {
  const body = await request.json();
  const clean = {};
  for (const key of ALLOWED_POLICY_COLS) {
    if (body[key] !== undefined && body[key] !== '') clean[key] = body[key];
  }
  const { error } = await supabase.from('policies').update(clean).eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request, { params }) {
  const { error } = await supabase.from('policies').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

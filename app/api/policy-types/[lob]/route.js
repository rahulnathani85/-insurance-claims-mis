import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  const { data, error } = await supabase
    .from('policy_types')
    .select('id, policy_type')
    .eq('lob', decodeURIComponent(params.lob))
    .order('policy_type');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

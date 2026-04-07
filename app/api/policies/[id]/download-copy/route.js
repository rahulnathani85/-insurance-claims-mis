import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  const { data, error } = await supabase.from('policies').select('policy_copy_url').eq('id', params.id).single();
  if (error || !data?.policy_copy_url) {
    return NextResponse.json({ error: 'No policy copy found' }, { status: 404 });
  }
  return NextResponse.redirect(data.policy_copy_url);
}

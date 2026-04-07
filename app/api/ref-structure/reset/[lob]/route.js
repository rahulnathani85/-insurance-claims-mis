import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function POST(request, { params }) {
  const lob = decodeURIComponent(params.lob);
  const body = await request.json();
  const newValue = body.counter_value || 0;

  if (lob === 'Marine Cargo' && body.client_category) {
    await supabase.from('marine_counters').update({ counter_value: newValue }).eq('client_category', body.client_category);
  } else {
    await supabase.from('ref_counters').update({ counter_value: newValue }).eq('lob', lob);
  }

  return NextResponse.json({ success: true });
}

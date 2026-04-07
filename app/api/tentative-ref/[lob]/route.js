import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';
import { MARINE_CLIENT_FORMATS } from '@/lib/constants';

// LOBs that share a unified counter (cross-company)
const UNIFIED_LOBS = ['Fire', 'Engineering', 'Business Interruption', 'Miscellaneous'];
const UNIFIED_COUNTER_KEY = 'General';

export async function GET(request, { params }) {
  const lob = decodeURIComponent(params.lob);
  const { searchParams } = new URL(request.url);
  const clientCategory = searchParams.get('client_category');

  if (lob === 'Marine Cargo') {
    // Named client categories use client-specific format
    if (clientCategory && clientCategory !== 'Others Domestic' && clientCategory !== 'Others Import') {
      const { data } = await supabase.from('marine_counters').select('counter_value').eq('client_category', clientCategory).single();
      const counter = (data?.counter_value || 0) + 1;
      const code = MARINE_CLIENT_FORMATS[clientCategory] || 'UNKNOWN';
      return NextResponse.json({ tentative_ref: `${code}-${String(counter).padStart(3, '0')}/26-27` });
    }
    // Generic Marine (Others or no category): use Marine counter starting at 4000
    const { data } = await supabase.from('ref_counters').select('counter_value').eq('lob', 'Marine').single();
    const counter = (data?.counter_value || 4000) + 1;
    return NextResponse.json({ tentative_ref: `${counter}/26-27/Marine` });
  }

  // For unified LOBs, use shared "General" counter
  const counterKey = UNIFIED_LOBS.includes(lob) ? UNIFIED_COUNTER_KEY : lob;

  const { data } = await supabase.from('ref_counters').select('counter_value').eq('lob', counterKey).single();
  const counter = (data?.counter_value || 0) + 1;

  const formats = {
    'Fire': `${counter}/26-27/Fire`,
    'Engineering': `${counter}/26-27/Engg`,
    'Extended Warranty': `EW-${String(counter).padStart(4, '0')}/26-27`,
    'Business Interruption': `${counter}/26-27/BI`,
    'Miscellaneous': `${counter}/26-27/Misc.`,
    'Banking': `INS-${String(counter).padStart(4, '0')}/26-27`,
    'Liability': `${counter}/26-27/LIABILITY`,
    'Marine Hull': `${counter}/26-27/Hull`,
    'Cat Event': `${counter}/26-27/CAT`,
  };

  return NextResponse.json({ tentative_ref: formats[lob] || `${counter}/26-27/${lob}` });
}

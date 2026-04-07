import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET() {
  const { data, error } = await supabase
    .from('insurer_offices')
    .select('id, name, type, city, insurers(company_name)')
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const offices = data.map(o => ({
    id: o.id, name: o.name, type: o.type, city: o.city,
    company: o.insurers?.company_name || ''
  }));
  return NextResponse.json(offices);
}

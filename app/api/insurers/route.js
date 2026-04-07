import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET() {
  const { data: insurers, error } = await supabase
    .from('insurers')
    .select('*, insurer_offices(*)')
    .order('company_name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = insurers.map(ins => ({
    ...ins,
    offices: ins.insurer_offices || []
  }));
  return NextResponse.json(result);
}

export async function POST(request) {
  const body = await request.json();
  const { data, error } = await supabase.from('insurers').insert([body]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}

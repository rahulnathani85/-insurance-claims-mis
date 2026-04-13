import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let query = supabase.from('claims').select('*').order('created_at', { ascending: false });

  if (searchParams.get('lob')) query = query.eq('lob', searchParams.get('lob'));
  if (searchParams.get('status')) query = query.eq('status', searchParams.get('status'));
  if (searchParams.get('ref_number')) query = query.ilike('ref_number', `%${searchParams.get('ref_number')}%`);
  if (searchParams.get('insurer_name')) query = query.ilike('insurer_name', `%${searchParams.get('insurer_name')}%`);
  if (searchParams.get('insured_name')) query = query.ilike('insured_name', `%${searchParams.get('insured_name')}%`);
  if (searchParams.get('policy_number')) query = query.ilike('policy_number', `%${searchParams.get('policy_number')}%`);
  if (searchParams.get('claim_number')) query = query.ilike('claim_number', `%${searchParams.get('claim_number')}%`);
  if (searchParams.get('date_loss_from')) query = query.gte('date_loss', searchParams.get('date_loss_from'));
  if (searchParams.get('date_loss_to')) query = query.lte('date_loss', searchParams.get('date_loss_to'));
  if (searchParams.get('date_intimation_from')) query = query.gte('date_of_intimation', searchParams.get('date_intimation_from'));
  if (searchParams.get('date_intimation_to')) query = query.lte('date_of_intimation', searchParams.get('date_intimation_to'));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Return JSON data - client side will use xlsx library to generate Excel
  return NextResponse.json(data);
}

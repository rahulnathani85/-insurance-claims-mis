import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET - List activity logs with optional filters
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const userEmail = searchParams.get('user_email');
  const claimId = searchParams.get('claim_id');
  const action = searchParams.get('action');
  const company = searchParams.get('company');
  const fromDate = searchParams.get('from_date');
  const toDate = searchParams.get('to_date');
  const limit = parseInt(searchParams.get('limit') || '200');

  let query = supabase
    .from('activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (userEmail) query = query.eq('user_email', userEmail);
  if (claimId) query = query.eq('claim_id', claimId);
  if (action) query = query.eq('action', action);
  if (company) query = query.eq('company', company);
  if (fromDate) query = query.gte('created_at', fromDate);
  if (toDate) query = query.lte('created_at', toDate + 'T23:59:59');

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST - Create activity log entry
export async function POST(request) {
  const body = await request.json();

  const { data, error } = await supabase
    .from('activity_log')
    .insert([{
      user_email: body.user_email,
      user_name: body.user_name,
      action: body.action,
      entity_type: body.entity_type,
      entity_id: body.entity_id,
      claim_id: body.claim_id,
      ref_number: body.ref_number,
      details: body.details,
      company: body.company,
    }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

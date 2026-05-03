import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { sanitiseSiteVisitPayload } from '@/lib/siteVisits';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claim_id = searchParams.get('claim_id');
  if (!claim_id) {
    return NextResponse.json({ error: 'claim_id is required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('site_visits')
    .select('*')
    .eq('claim_id', claim_id)
    .order('visit_number', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(request) {
  const body = await request.json();
  if (!body.claim_id) {
    return NextResponse.json({ error: 'claim_id is required' }, { status: 400 });
  }

  let payload;
  try {
    payload = sanitiseSiteVisitPayload(body);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  // Auto-assign next visit_number if caller didn't pick one.
  if (!payload.visit_number) {
    const { data: max } = await supabaseAdmin
      .from('site_visits')
      .select('visit_number')
      .eq('claim_id', body.claim_id)
      .order('visit_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    payload.visit_number = (max?.visit_number || 0) + 1;
  }

  const insert = { claim_id: body.claim_id, ...payload };

  const { data, error } = await supabaseAdmin
    .from('site_visits')
    .insert([insert])
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `Visit #${insert.visit_number} already exists for this claim` },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}

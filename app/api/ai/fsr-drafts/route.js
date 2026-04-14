import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// GET - Load FSR drafts for a claim
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claim_id = searchParams.get('claim_id');
  if (!claim_id) return NextResponse.json({ error: 'claim_id required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('claim_fsr_drafts')
    .select('*')
    .eq('claim_id', claim_id)
    .order('version_number', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

// PUT - Update draft content or approve
export async function PUT(request) {
  const body = await request.json();
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const updates = {};
  if (body.draft_content !== undefined) updates.draft_content = body.draft_content;
  if (body.status) {
    updates.status = body.status;
    if (body.status === 'approved') {
      updates.approved_by = body.approved_by || null;
      updates.approved_at = new Date().toISOString();
    }
  }

  const { data, error } = await supabaseAdmin
    .from('claim_fsr_drafts')
    .update(updates)
    .eq('id', body.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

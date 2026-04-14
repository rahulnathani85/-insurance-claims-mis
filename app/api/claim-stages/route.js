import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';

// GET - Get pipeline stages for a claim (full audit trail)
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claimId = searchParams.get('claim_id');

  if (!claimId) {
    return NextResponse.json({ error: 'claim_id is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('claim_stages')
    .select('*')
    .eq('claim_id', claimId)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST - Advance claim to a new pipeline stage
export async function POST(request) {
  const body = await request.json();

  if (!body.claim_id || !body.stage) {
    return NextResponse.json({ error: 'claim_id and stage are required' }, { status: 400 });
  }

  try {
    // Insert new stage row (append-only audit trail)
    const { data, error } = await supabaseAdmin
      .from('claim_stages')
      .insert([{
        claim_id: body.claim_id,
        stage: body.stage,
        stage_number: body.stage_number || null,
        stage_date: body.stage_date || new Date().toISOString().split('T')[0],
        notes: body.notes || null,
        updated_by: body.updated_by || null,
        entered_by: body.entered_by || body.updated_by || null,
        company: body.company || 'NISLA',
      }])
      .select()
      .single();

    if (error) throw error;

    // Update denormalized cache on claims table
    if (body.stage_number) {
      const cacheUpdate = {
        pipeline_stage: body.stage,
        pipeline_stage_number: body.stage_number,
      };

      // Auto-sync claims.status based on pipeline stage
      if (body.stage_number <= 2) cacheUpdate.status = 'Open';
      else if (body.stage_number <= 7) cacheUpdate.status = 'In Process';
      else if (body.stage_number === 8) cacheUpdate.status = 'Submitted';
      else if (body.stage_number === 9) cacheUpdate.status = 'Submitted';

      await supabaseAdmin
        .from('claims')
        .update(cacheUpdate)
        .eq('id', body.claim_id);
    }

    // Log to activity_log
    await supabaseAdmin.from('activity_log').insert([{
      user_email: body.updated_by || null,
      user_name: body.user_name || null,
      action: 'pipeline_stage_update',
      entity_type: 'claims',
      entity_id: body.claim_id,
      details: JSON.stringify({ stage: body.stage, stage_number: body.stage_number, notes: body.notes }),
      company: body.company || 'NISLA',
    }]).catch(() => {}); // non-fatal

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// PUT - Update notes on an existing stage row
export async function PUT(request) {
  const body = await request.json();

  if (!body.id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const updates = {};
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.updated_by) updates.updated_by = body.updated_by;

  const { data, error } = await supabaseAdmin
    .from('claim_stages')
    .update(updates)
    .eq('id', body.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

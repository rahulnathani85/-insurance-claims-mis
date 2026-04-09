import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// GET - Fetch stages for an EW claim
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const ew_claim_id = searchParams.get('ew_claim_id');
    if (!ew_claim_id) return NextResponse.json({ error: 'ew_claim_id required' }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('ew_claim_stages')
      .select('*')
      .eq('ew_claim_id', ew_claim_id)
      .order('stage_number', { ascending: true });

    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT - Update a stage (complete, skip, add notes)
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, ew_claim_id, stage_number, status, notes, updated_by } = body;

    if (!id && !ew_claim_id) return NextResponse.json({ error: 'id or ew_claim_id required' }, { status: 400 });

    const updates = { updated_at: new Date().toISOString() };
    if (status) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    if (updated_by) updates.updated_by = updated_by;

    if (status === 'In Progress' && !updates.started_date) {
      updates.started_date = new Date().toISOString();
    }
    if (status === 'Completed') {
      updates.completed_date = new Date().toISOString();
    }

    let query;
    if (id) {
      query = supabaseAdmin.from('ew_claim_stages').update(updates).eq('id', id);
    } else {
      query = supabaseAdmin.from('ew_claim_stages').update(updates).eq('ew_claim_id', ew_claim_id).eq('stage_number', stage_number);
    }

    const { data, error } = await query.select().single();
    if (error) throw error;

    // If completing a stage, auto-advance current_stage on the parent claim
    if (status === 'Completed' && ew_claim_id) {
      const completedStage = data.stage_number;
      const nextStage = completedStage + 1;

      // Start next stage if exists
      if (nextStage <= 12) {
        await supabaseAdmin
          .from('ew_claim_stages')
          .update({ status: 'In Progress', started_date: new Date().toISOString() })
          .eq('ew_claim_id', ew_claim_id)
          .eq('stage_number', nextStage)
          .eq('status', 'Pending');

        // Get next stage name
        const { data: nextStageData } = await supabaseAdmin
          .from('ew_claim_stages')
          .select('stage_name')
          .eq('ew_claim_id', ew_claim_id)
          .eq('stage_number', nextStage)
          .single();

        // Update claim status
        let claimStatus = 'In Progress';
        if (nextStage >= 11) claimStatus = 'Assessment';

        await supabaseAdmin
          .from('ew_vehicle_claims')
          .update({
            current_stage: nextStage,
            current_stage_name: nextStageData?.stage_name || `Stage ${nextStage}`,
            status: claimStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', ew_claim_id);
      } else {
        // All stages completed
        await supabaseAdmin
          .from('ew_vehicle_claims')
          .update({
            current_stage: 12,
            current_stage_name: 'FSR Prepared',
            status: 'Completed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', ew_claim_id);
      }
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

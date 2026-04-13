import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Fields that live in both claims and ew_vehicle_claims and should stay in sync.
const SHARED_CLAIM_EW_FIELDS = [
  'insured_name',
  'insured_address',
  'policy_number',
  'claim_file_no',
  'person_contacted',
  'estimated_loss_amount',
  'date_of_intimation',
  // 3-office insurer model
  'appointing_office_id',
  'appointing_office_name',
  'appointing_office_address',
  'policy_office_id',
  'policy_office_name',
  'policy_office_address',
  'fsr_office_id',
  'fsr_office_name',
  'fsr_office_address',
];

// GET - Fetch single claim by ID
export async function GET(request, { params }) {
  const { id } = params;
  const { data, error } = await supabase
    .from('claims')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

// LOBs that share a unified counter (cross-company)
const UNIFIED_LOBS = ['Fire', 'Engineering', 'Business Interruption', 'Miscellaneous'];
const UNIFIED_COUNTER_KEY = 'General';

// Decrement counter when claim is deleted
async function decrementCounter(lob, clientCategory) {
  if (lob === 'Marine Cargo') {
    const cat = (clientCategory === 'Others Domestic' || clientCategory === 'Others Import') ? 'Others Domestic' : clientCategory;
    if (cat) {
      const { data } = await supabase.from('marine_counters').select('counter_value').eq('client_category', cat).single();
      if (data && data.counter_value > 0) {
        await supabase.from('marine_counters').update({ counter_value: data.counter_value - 1 }).eq('client_category', cat);
      }
    }
    return;
  }
  const counterKey = UNIFIED_LOBS.includes(lob) ? UNIFIED_COUNTER_KEY : lob;
  const { data } = await supabase.from('ref_counters').select('counter_value').eq('lob', counterKey).single();
  if (data && data.counter_value > 0) {
    await supabase.from('ref_counters').update({ counter_value: data.counter_value - 1 }).eq('lob', counterKey);
  }
}

export async function PUT(request, { params }) {
  const id = params.id;
  const body = await request.json();

  // Check if LOB is being changed
  const lobChanged = body._lob_changed;
  const oldLob = body._old_lob;
  const newLob = body._new_lob;
  delete body._lob_changed;
  delete body._old_lob;
  delete body._new_lob;

  // Flag from the EW detail page telling us to skip the claims -> ew sync
  // (the caller already updated the EW row and would cause a loop).
  const skipEwSync = body._skip_ew_sync === true;
  delete body._skip_ew_sync;

  // Remove fields that shouldn't be updated directly
  delete body.id;
  delete body.created_at;
  delete body._tentative_ref;
  delete body._manual_ref_number;

  // If LOB changed, we may need to regenerate ref number and folder path
  if (lobChanged && oldLob !== newLob) {
    // The ref_number and folder_path should already be set by the client or we keep the existing ones
    // We allow the LOB change but keep the existing ref_number unless a new one is provided
  }

  // Allow ref_number update if explicitly provided (for LOB change scenarios)
  if (!body.ref_number) {
    delete body.ref_number;
  }

  // Clean empty estimated_loss_amount so Postgres numeric doesn't choke on ""
  if (body.estimated_loss_amount === '' || body.estimated_loss_amount === null) {
    delete body.estimated_loss_amount;
  } else if (body.estimated_loss_amount !== undefined) {
    const n = parseFloat(body.estimated_loss_amount);
    if (isNaN(n)) delete body.estimated_loss_amount;
    else body.estimated_loss_amount = n;
  }

  const { error } = await supabase.from('claims').update(body).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Bidirectional sync: push shared field updates to any linked ew_vehicle_claims row.
  // Fire-and-forget so the caller's response isn't held up by the sync.
  if (!skipEwSync) {
    try {
      const ewUpdate = {};
      SHARED_CLAIM_EW_FIELDS.forEach(f => {
        if (body[f] !== undefined) ewUpdate[f] = body[f];
      });
      if (Object.keys(ewUpdate).length > 0) {
        ewUpdate.updated_at = new Date().toISOString();
        await supabase
          .from('ew_vehicle_claims')
          .update(ewUpdate)
          .eq('claim_id', id);
      }
    } catch (syncErr) {
      // Non-fatal
      console.warn('EW sync from claims update failed:', syncErr?.message || syncErr);
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request, { params }) {
  const id = params.id;

  // First, get the claim details to know which counter to decrement
  const { data: claim, error: fetchError } = await supabase
    .from('claims')
    .select('lob, client_category')
    .eq('id', id)
    .single();

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 400 });

  // Delete the claim
  const { error } = await supabase.from('claims').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Decrement the counter so next claim gets the same number
  if (claim) {
    await decrementCounter(claim.lob, claim.client_category);
  }

  return NextResponse.json({ success: true });
}

import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

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

  const { error } = await supabase.from('claims').update(body).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
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

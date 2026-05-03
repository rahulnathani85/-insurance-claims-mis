import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { dualWriteClaimFields } from '@/lib/provenance';
import { requireSurveyorRequest } from '@/lib/auth/insurer';

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
  // Phase 2 mutation guard — refuse insurer_readonly principals.
  // The X-User-Email header is set by lib/api/authedFetch on every
  // authenticated request. Server-to-server / cron requests with no
  // header pass through.
  try {
    await requireSurveyorRequest(request);
  } catch (e) {
    if (e?.code === 'INSURER_FORBIDDEN') {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    throw e;
  }

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

  // If the claim is currently in the 'intimation' phase, completing the
  // edit IS the registration act — flip phase to 'registered' and stamp
  // who/when. Caller may have explicitly set phase already (e.g. from a
  // dedicated register endpoint); preserve that.
  if (body.phase === undefined) {
    const { data: existing } = await supabase
      .from('claims')
      .select('phase')
      .eq('id', id)
      .single();
    if (existing?.phase === 'intimation') {
      body.phase = 'registered';
      body.registered_at = new Date().toISOString();
      const userEmail = request.headers.get('x-app-user-email');
      if (userEmail && body.registered_by === undefined) {
        body.registered_by = userEmail;
      }
    }
  }

  const { error } = await supabase.from('claims').update(body).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Provenance Phase B (dual-write) — for any provenance-managed field in
  // the body, append a row to claim_field_values via the decision engine.
  // Failures here do NOT roll back the legacy update; provenance is the
  // observability layer until Phase C switches reads. See CLAUDE.md §13a.
  //
  // Per-field errors are captured by dualWriteClaimFields into the return
  // value rather than thrown; we surface any errors to the server log here
  // so silent skips during the rollout are visible in dev / Vercel logs.
  try {
    const userEmail = request.headers.get('x-app-user-email');
    const provResult = await dualWriteClaimFields(supabaseAdmin, id, body, {
      type: 'manual',
      documentType: 'manual_entry',
      label: 'Edit via /api/claims/[id] PUT',
      extractedBy: `human:${userEmail || 'unknown'}`,
      capturedBy: userEmail || null,
    });
    const fieldErrors = (provResult?.provenance || []).filter((r) => r.error);
    if (fieldErrors.length > 0) {
      console.warn(
        `[provenance] claim ${id}: ${fieldErrors.length} field(s) failed dual-write —`,
        fieldErrors.map((r) => `${r.field_name}: ${r.error}`).join('; ')
      );
    }
  } catch (provErr) {
    // Non-fatal — Phase B prioritises legacy correctness.
    console.warn(`[provenance] claim ${id}: dual-write threw —`, provErr?.message || provErr);
  }

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
  // Phase 2 mutation guard
  try {
    await requireSurveyorRequest(request);
  } catch (e) {
    if (e?.code === 'INSURER_FORBIDDEN') {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    throw e;
  }

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

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GIPSA Extended Warranty fee slab (mirrors /api/survey-fee-bills).
// Returns professional fee (pre-GST) for an assessed loss amount.
function calculateEwFee(lossAmount) {
  const a = parseFloat(lossAmount) || 0;
  if (a <= 0) return 0;
  let fee = 0;
  if (a <= 50000) fee = 2500;
  else if (a <= 200000) fee = a * 0.04;
  else if (a <= 500000) fee = 8000 + (a - 200000) * 0.03;
  else fee = 17000 + (a - 500000) * 0.02;
  return Math.round(fee * 100) / 100;
}

function round2(x) { return Math.round((parseFloat(x) || 0) * 100) / 100; }

// GET — list lots, or fetch a single lot with its claims
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const company = searchParams.get('company');
    const id = searchParams.get('id');

    if (id) {
      const { data: lot, error: e1 } = await supabaseAdmin
        .from('ew_lots')
        .select('*')
        .eq('id', id)
        .single();
      if (e1) throw e1;

      const { data: items, error: e2 } = await supabaseAdmin
        .from('ew_lot_claims')
        .select('*, ew_vehicle_claims:ew_claim_id (id, ref_number, customer_name, insured_name, vehicle_reg_no, chassis_number, vehicle_make, model_fuel_type, policy_number, claim_file_no, date_of_intimation, survey_date, report_date, gross_assessed_amount, net_adjusted_amount, estimated_loss_amount, dealer_name, survey_location, dismantled_observation, customer_complaint, warranty_plan, fsr_generated_at, company)')
        .eq('lot_id', id)
        .order('position', { ascending: true });
      if (e2) throw e2;

      return NextResponse.json({ ...lot, items: items || [] });
    }

    let query = supabaseAdmin
      .from('ew_lots')
      .select('*')
      .order('lot_date', { ascending: false })
      .order('id', { ascending: false });

    if (company && company !== 'All') {
      query = query.eq('company', company);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST — create a new lot from a set of ew_claim_ids.
// Body: {
//   company, lot_number (optional), lot_date, ew_program, notes,
//   claims: [ { ew_claim_id, reinspection_fee?, conveyance?, photographs? } ],
//   created_by
// }
export async function POST(request) {
  try {
    const body = await request.json();
    const company = body.company || 'NISLA';
    const claims = Array.isArray(body.claims) ? body.claims : [];

    if (claims.length === 0) {
      return NextResponse.json({ error: 'At least one claim is required' }, { status: 400 });
    }

    // Auto-assign lot number if none provided
    let lotNumber = (body.lot_number || '').trim();
    if (!lotNumber) {
      const { data: counter } = await supabaseAdmin
        .from('ew_lot_counters')
        .select('current_count')
        .eq('company', company)
        .maybeSingle();
      const next = (counter?.current_count || 0) + 1;
      lotNumber = String(next);
      if (counter) {
        await supabaseAdmin
          .from('ew_lot_counters')
          .update({ current_count: next, updated_at: new Date().toISOString() })
          .eq('company', company);
      } else {
        await supabaseAdmin
          .from('ew_lot_counters')
          .insert({ company, current_count: next });
      }
    } else {
      // Check uniqueness within the company for manually entered lot numbers
      const { data: existing } = await supabaseAdmin
        .from('ew_lots')
        .select('id')
        .eq('company', company)
        .eq('lot_number', lotNumber)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({ error: `Lot number ${lotNumber} already exists for ${company}` }, { status: 409 });
      }
    }

    // Fetch the claim rows we'll snapshot into ew_lot_claims
    const claimIds = claims.map(c => c.ew_claim_id);
    const { data: claimRows, error: claimErr } = await supabaseAdmin
      .from('ew_vehicle_claims')
      .select('*')
      .in('id', claimIds);
    if (claimErr) throw claimErr;

    const claimMap = Object.fromEntries((claimRows || []).map(r => [r.id, r]));

    // Build snapshot rows
    const lineItems = claims.map((c, idx) => {
      const r = claimMap[c.ew_claim_id] || {};
      const lossBasis = round2(r.gross_assessed_amount || r.net_adjusted_amount || r.estimated_loss_amount || 0);
      const professionalFee = c.professional_fee != null ? round2(c.professional_fee) : calculateEwFee(lossBasis);
      const reinspection = round2(c.reinspection_fee || 0);
      const conveyance = round2(c.conveyance || 0);
      const photographs = round2(c.photographs || 0);
      const totalBill = round2(professionalFee + reinspection + conveyance + photographs);
      const gst = round2(totalBill * 0.18);
      const totalAmount = round2(totalBill + gst);

      return {
        ew_claim_id: c.ew_claim_id,
        position: idx + 1,
        ref_number: r.ref_number || null,
        claim_file_no: r.claim_file_no || null,
        policy_number: r.policy_number || null,
        insured_name: r.insured_name || null,
        customer_name: r.customer_name || null,
        vehicle_reg_no: r.vehicle_reg_no || null,
        chassis_number: r.chassis_number || null,
        vehicle_make: r.vehicle_make || null,
        vehicle_model: r.model_fuel_type || null,
        date_of_intimation: r.date_of_intimation || null,
        date_of_loss: r.complaint_date || r.date_of_intimation || null,
        report_date: r.report_date || null,
        estimated_loss_amount: r.estimated_loss_amount || null,
        gross_assessed_amount: r.gross_assessed_amount || null,
        net_adjusted_amount: r.net_adjusted_amount || null,
        admissibility: c.admissibility || 'Admissible',
        location: c.location || r.survey_location || null,
        workshop_name: c.workshop_name || r.dealer_name || null,
        breakdown_details: c.breakdown_details || r.customer_complaint || r.dismantled_observation || null,
        service_request_number: c.service_request_number || r.claim_file_no || null,
        professional_fee: professionalFee,
        reinspection_fee: reinspection,
        conveyance,
        photographs,
        total_bill: totalBill,
        gst,
        total_amount: totalAmount,
      };
    });

    // Roll-ups
    const totals = lineItems.reduce((acc, i) => {
      acc.professional_fee += i.professional_fee;
      acc.reinspection += i.reinspection_fee;
      acc.conveyance += i.conveyance;
      acc.photographs += i.photographs;
      acc.total_bill += i.total_bill;
      acc.gst += i.gst;
      acc.total_amount += i.total_amount;
      return acc;
    }, { professional_fee: 0, reinspection: 0, conveyance: 0, photographs: 0, total_bill: 0, gst: 0, total_amount: 0 });

    const surveyorName = company === 'NISLA'
      ? 'Nathani Insurance Surveyors and Loss Assessors'
      : 'Acuere Surveyors';

    const lotRecord = {
      lot_number: lotNumber,
      company,
      lot_date: body.lot_date || new Date().toISOString().split('T')[0],
      ew_program: body.ew_program || null,
      insurer_name: body.insurer_name || (claimRows?.[0]?.insurer_name || null),
      surveyor_name: surveyorName,
      notes: body.notes || null,
      claim_count: lineItems.length,
      total_professional_fee: round2(totals.professional_fee),
      total_reinspection: round2(totals.reinspection),
      total_conveyance: round2(totals.conveyance),
      total_photographs: round2(totals.photographs),
      total_bill: round2(totals.total_bill),
      total_gst: round2(totals.gst),
      total_amount: round2(totals.total_amount),
      status: 'Draft',
      created_by: body.created_by || null,
    };

    const { data: lot, error: lotErr } = await supabaseAdmin
      .from('ew_lots')
      .insert([lotRecord])
      .select()
      .single();
    if (lotErr) throw lotErr;

    // Attach lot_id to each line item and bulk insert
    const toInsert = lineItems.map(i => ({ ...i, lot_id: lot.id }));
    const { error: itemErr } = await supabaseAdmin
      .from('ew_lot_claims')
      .insert(toInsert);
    if (itemErr) {
      // Roll back the lot on partial failure
      await supabaseAdmin.from('ew_lots').delete().eq('id', lot.id);
      throw itemErr;
    }

    // Stamp the lot_number + lot_id back onto each participating claim so the
    // MIS page can show the lot badge and colour the row green without joins.
    const realClaimIds = claimIds.filter(cid => cid && !String(cid).startsWith('claim-'));
    if (realClaimIds.length > 0) {
      const { error: stampErr } = await supabaseAdmin
        .from('ew_vehicle_claims')
        .update({ lot_id: lot.id, lot_number: lotNumber, updated_at: new Date().toISOString() })
        .in('id', realClaimIds);
      if (stampErr) {
        // Non-fatal — lot itself is valid. Log but still return the lot.
        console.warn('Failed to stamp lot_number on claims:', stampErr.message);
      }
    }

    await supabaseAdmin.from('activity_log').insert([{
      user_email: body.created_by || null,
      action: 'create_ew_lot',
      entity_type: 'ew_lots',
      entity_id: lot.id,
      details: { lot_number: lotNumber, claim_count: lineItems.length, ew_program: lotRecord.ew_program },
      company,
    }]);

    return NextResponse.json(lot, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT — update lot meta (status, notes, ew_program, lot_date, lot_number)
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    // If lot_number changed, re-check uniqueness
    if (updates.lot_number) {
      const { data: existing } = await supabaseAdmin
        .from('ew_lots')
        .select('id,company')
        .eq('id', id)
        .single();
      if (existing) {
        const { data: clash } = await supabaseAdmin
          .from('ew_lots')
          .select('id')
          .eq('company', existing.company)
          .eq('lot_number', updates.lot_number)
          .neq('id', id)
          .maybeSingle();
        if (clash) {
          return NextResponse.json({ error: `Lot number ${updates.lot_number} already exists for ${existing.company}` }, { status: 409 });
        }
      }
    }

    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('ew_lots')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE — cascades to ew_lot_claims via FK. Also clears lot_number / lot_id
// stamps on ew_vehicle_claims so the MIS loses the green highlight.
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    // Defensive pre-clean: even without the DB trigger, null the claim stamps
    // before the lot itself disappears.
    await supabaseAdmin
      .from('ew_vehicle_claims')
      .update({ lot_id: null, lot_number: null, updated_at: new Date().toISOString() })
      .eq('lot_id', id);

    const { error } = await supabaseAdmin
      .from('ew_lots')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

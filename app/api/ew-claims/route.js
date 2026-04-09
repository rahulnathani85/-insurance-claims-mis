import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const EW_STAGES = [
  { number: 1, name: 'Claim Intimation' },
  { number: 2, name: 'Claim Registration' },
  { number: 3, name: 'Contact Dealer' },
  { number: 4, name: 'Initial Inspection' },
  { number: 5, name: 'Document Analysis' },
  { number: 6, name: 'Initial Observation Shared' },
  { number: 7, name: 'Dismantled Inspection' },
  { number: 8, name: 'Estimate Approved' },
  { number: 9, name: 'Reinspection' },
  { number: 10, name: 'Tax Invoice Collected' },
  { number: 11, name: 'Assessment Done' },
  { number: 12, name: 'FSR Prepared' },
];

// GET - List EW claims with filters
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const company = searchParams.get('company');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const id = searchParams.get('id');

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('ew_vehicle_claims')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return NextResponse.json(data);
    }

    let query = supabaseAdmin
      .from('ew_vehicle_claims')
      .select('*')
      .order('created_at', { ascending: false });

    if (company && company !== 'All') {
      query = query.eq('company', company);
    }
    if (status) {
      query = query.eq('status', status);
    }
    if (search) {
      query = query.or(`ref_number.ilike.%${search}%,customer_name.ilike.%${search}%,vehicle_reg_no.ilike.%${search}%,chassis_number.ilike.%${search}%,claim_file_no.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Create new EW claim and initialize lifecycle stages
export async function POST(request) {
  try {
    const body = await request.json();
    const company = body.company || 'NISLA';

    let ref_number = body.ref_number;

    if (!ref_number && !body.claim_id) {
      const { data: counter, error: counterErr } = await supabaseAdmin
        .from('ref_counters')
        .select('current_count')
        .eq('lob', 'Extended Warranty')
        .eq('company', company)
        .single();

      let nextCount = 1;
      if (counter) {
        nextCount = (counter.current_count || 0) + 1;
        await supabaseAdmin
          .from('ref_counters')
          .update({ current_count: nextCount })
          .eq('lob', 'Extended Warranty')
          .eq('company', company);
      } else {
        await supabaseAdmin
          .from('ref_counters')
          .insert({ lob: 'Extended Warranty', company, current_count: 1 });
      }

      const yearSuffix = getFinancialYearSuffix();
      ref_number = `EW-${String(nextCount).padStart(4, '0')}/${yearSuffix}`;
    }

    const claimData = {
      ...body,
      ref_number,
      company,
      current_stage: 1,
      current_stage_name: 'Claim Intimation',
      status: 'Open',
    };

    const { data: ewClaim, error: insertErr } = await supabaseAdmin
      .from('ew_vehicle_claims')
      .insert([claimData])
      .select()
      .single();

    if (insertErr) throw insertErr;

    const stages = EW_STAGES.map(s => ({
      ew_claim_id: ewClaim.id,
      stage_number: s.number,
      stage_name: s.name,
      status: s.number === 1 ? 'In Progress' : 'Pending',
      started_date: s.number === 1 ? new Date().toISOString() : null,
    }));

    const { error: stagesErr } = await supabaseAdmin
      .from('ew_claim_stages')
      .insert(stages);

    if (stagesErr) throw stagesErr;

    await supabaseAdmin.from('activity_log').insert([{
      user_email: body.created_by,
      action: 'create_ew_claim',
      entity_type: 'ew_vehicle_claims',
      entity_id: ewClaim.id,
      details: { ref_number, customer_name: body.customer_name, vehicle_reg_no: body.vehicle_reg_no },
      company,
    }]);

    return NextResponse.json(ewClaim, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT - Update EW claim
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('ew_vehicle_claims')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Remove EW claim
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const { error } = await supabaseAdmin
      .from('ew_vehicle_claims')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function getFinancialYearSuffix() {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const startYear = month >= 3 ? year : year - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

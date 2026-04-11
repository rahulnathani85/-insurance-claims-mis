import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
// Also returns unlinked claims from claims table with LOB=Extended Warranty
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const company = searchParams.get('company');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const id = searchParams.get('id');
    const claimId = searchParams.get('claim_id');

    // Fetch single EW claim by id
    if (id) {
      const { data, error } = await supabaseAdmin
        .from('ew_vehicle_claims')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return NextResponse.json(data);
    }

    // Fetch EW claim by linked claims table id
    if (claimId) {
      const { data, error } = await supabaseAdmin
        .from('ew_vehicle_claims')
        .select('*')
        .eq('claim_id', parseInt(claimId))
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      if (data) return NextResponse.json(data);
      return NextResponse.json(null);
    }

    // List all EW claims
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
      query = query.or(`ref_number.ilike.%${search}%,customer_name.ilike.%${search}%,vehicle_reg_no.ilike.%${search}%,chassis_number.ilike.%${search}%,claim_file_no.ilike.%${search}%,insured_name.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    // De-duplicate ew_vehicle_claims themselves defensively by (company, ref_number)
    // so the UI never shows the same ref twice even if stale duplicates exist pre-migration.
    const seenRefKeys = new Set();
    const dedupedEw = [];
    for (const row of (data || [])) {
      const key = `${row.company || ''}::${row.ref_number || `__id_${row.id}`}`;
      if (seenRefKeys.has(key)) continue;
      seenRefKeys.add(key);
      dedupedEw.push(row);
    }

    // Also find unlinked claims from main claims table with LOB=Extended Warranty
    const linkedClaimIds = dedupedEw.filter(d => d.claim_id).map(d => d.claim_id);
    let unlinkedQuery = supabaseAdmin
      .from('claims')
      .select('*')
      .eq('lob', 'Extended Warranty')
      .order('created_at', { ascending: false });

    if (company && company !== 'All') {
      unlinkedQuery = unlinkedQuery.eq('company', company);
    }
    if (linkedClaimIds.length > 0) {
      // Exclude claims already linked to EW records
      unlinkedQuery = unlinkedQuery.not('id', 'in', `(${linkedClaimIds.join(',')})`);
    }

    const { data: unlinkedClaims } = await unlinkedQuery;

    // Convert unlinked claims to EW format AND suppress any whose ref_number
    // already appears in the ew_vehicle_claims list for the same company.
    const unlinkedFormatted = (unlinkedClaims || [])
      .filter(c => {
        const key = `${c.company || ''}::${c.ref_number || ''}`;
        if (seenRefKeys.has(key)) return false; // already shown via ew_vehicle_claims
        seenRefKeys.add(key);
        return true;
      })
      .map(c => ({
        id: `claim-${c.id}`,
        claim_id: c.id,
        ref_number: c.ref_number,
        company: c.company,
        insured_name: c.insured_name,
        customer_name: c.insured_name,
        vehicle_reg_no: null,
        vehicle_make: c.model_spec || null,
        chassis_number: c.chassis_number || null,
        dealer_name: c.dealer_name || null,
        current_stage: 0,
        current_stage_name: 'Not Started',
        status: c.status || 'Open',
        created_at: c.created_at,
        _source: 'claims',
        _needs_ew_setup: true,
      }));

    return NextResponse.json([...dedupedEw, ...unlinkedFormatted]);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Helper - case-insensitive check whether a ref_number already exists for a company,
// either in ew_vehicle_claims OR in the main claims table (so we can't create a
// duplicate across the two surfaces either).
async function refNumberExists(company, refNumber) {
  if (!refNumber) return false;
  const [{ data: ewRow }, { data: cRow }] = await Promise.all([
    supabaseAdmin
      .from('ew_vehicle_claims')
      .select('id')
      .eq('company', company)
      .ilike('ref_number', refNumber)
      .maybeSingle(),
    supabaseAdmin
      .from('claims')
      .select('id')
      .eq('company', company)
      .ilike('ref_number', refNumber)
      .maybeSingle(),
  ]);
  return Boolean(ewRow || cRow);
}

// POST - Create new EW claim and initialize lifecycle stages
export async function POST(request) {
  try {
    const body = await request.json();
    const company = body.company || 'NISLA';

    let ref_number = (body.ref_number || '').trim() || null;

    // CASE 1: Caller supplied a ref_number explicitly - MUST be unique.
    if (ref_number) {
      const exists = await refNumberExists(company, ref_number);
      if (exists) {
        return NextResponse.json(
          { error: `Reference number ${ref_number} is already registered for ${company}. Please use a different reference number.` },
          { status: 409 }
        );
      }
    }

    // CASE 2: Auto-generate ref_number from the EW counter, skipping any slots
    // that are already occupied in ew_vehicle_claims or claims.
    if (!ref_number && !body.claim_id) {
      const { data: counter } = await supabaseAdmin
        .from('ref_counters')
        .select('current_count')
        .eq('lob', 'Extended Warranty')
        .eq('company', company)
        .single();

      let nextCount = (counter?.current_count || 0) + 1;
      const yearSuffix = getFinancialYearSuffix();

      // Safety: advance the counter past any pre-existing collisions so we
      // never hand out a ref_number that is already in the database.
      // Cap at 10_000 iterations so we never loop forever on a pathological table.
      let candidate = `EW-${String(nextCount).padStart(4, '0')}/${yearSuffix}`;
      for (let i = 0; i < 10000; i++) {
        // eslint-disable-next-line no-await-in-loop
        const clash = await refNumberExists(company, candidate);
        if (!clash) break;
        nextCount += 1;
        candidate = `EW-${String(nextCount).padStart(4, '0')}/${yearSuffix}`;
      }
      ref_number = candidate;

      if (counter) {
        await supabaseAdmin
          .from('ref_counters')
          .update({ current_count: nextCount })
          .eq('lob', 'Extended Warranty')
          .eq('company', company);
      } else {
        await supabaseAdmin
          .from('ref_counters')
          .insert({ lob: 'Extended Warranty', company, current_count: nextCount });
      }
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

    if (insertErr) {
      // Postgres unique_violation - caught here if two POSTs race past the
      // pre-check and hit the UNIQUE (company, ref_number) constraint added in v15.
      if (insertErr.code === '23505') {
        return NextResponse.json(
          { error: `Reference number ${ref_number} is already registered for ${company}. Please retry - a fresh number will be issued.` },
          { status: 409 }
        );
      }
      throw insertErr;
    }

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

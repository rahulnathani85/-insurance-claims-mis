// =============================================================================
// /api/offices
// =============================================================================
// GET — Flat list of all offices, used by the office-picker dropdown on
// the legacy claim forms (where the picker is just a select with all
// offices regardless of insurer).
//
// Reads from v_insurer_offices_with_path so the response includes
// hierarchy_path + parent_office_id + is_active alongside the existing
// fields. Frontend can ignore the new fields if it doesn't need them
// (backward compatible).
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Pull the office rows from the view + a lightweight join on insurers
  // for the company_name. PostgREST won't auto-join from a view, so we
  // run two queries and merge in JS — both are tiny tables.
  const { data: offices, error: oErr } = await supabaseAdmin
    .from('v_insurer_offices_with_path')
    .select(
      'id, insurer_id, name, type, office_code, address, city, state, pin, ' +
      'gstin, phone, email, contact_person, hierarchy_path, depth, ' +
      'parent_office_id, is_active, office_short_code'
    )
    .order('name');

  if (oErr) {
    return NextResponse.json({ error: oErr.message }, { status: 500 });
  }

  const insurerIds = Array.from(
    new Set((offices || []).map((o) => o.insurer_id).filter(Boolean))
  );

  let insurerNameById = new Map();
  if (insurerIds.length > 0) {
    const { data: insurers, error: iErr } = await supabaseAdmin
      .from('insurers')
      .select('id, company_name')
      .in('id', insurerIds);
    if (iErr) {
      return NextResponse.json({ error: iErr.message }, { status: 500 });
    }
    insurerNameById = new Map(
      (insurers || []).map((i) => [i.id, i.company_name])
    );
  }

  const out = (offices || []).map((o) => ({
    id: o.id,
    name: o.name,
    type: o.type,
    office_code: o.office_code,
    address: o.address || '',
    city: o.city || '',
    state: o.state || '',
    pin: o.pin || '',
    gstin: o.gstin || '',
    phone: o.phone || '',
    email: o.email || '',
    contact_person: o.contact_person || '',
    hierarchy_path: o.hierarchy_path || o.name,
    depth: o.depth ?? 1,
    parent_office_id: o.parent_office_id ?? null,
    is_active: o.is_active ?? true,
    office_short_code: o.office_short_code || '',
    company: insurerNameById.get(o.insurer_id) || '',
  }));

  return NextResponse.json(out);
}

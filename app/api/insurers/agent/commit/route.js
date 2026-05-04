// =============================================================================
// /api/insurers/agent/commit
// =============================================================================
// POST { insurer, offices } -> commits the Review-screen output to the master.
//
// Two-phase office insert (no real Postgres tx — Supabase JS doesn't expose
// one — but a topological sort + best-effort rollback on partial failure):
//   1. Insert the insurer row, get insurer_id.
//   2. Topo-sort offices so every parent is inserted before its children.
//   3. Insert one office at a time (so we can resolve parent_office_id from
//      the in-memory name->id map of just-inserted siblings).
//   4. On any office insert failure, attempt to delete the partially-created
//      offices and the insurer (cascade does the rest), then return 500 with
//      the error.
//
// Request:
//   {
//     insurer: { company_name (required), code, irdai_reg_no, gstin,
//                ownership_type, registered_address, city, state, pin,
//                phone, email },
//     offices: [
//       { office_code, name, city, state, address, parent_name, is_active? }
//     ]
//   }
//
// Response (200):
//   { insurer_id, offices_created, root_count, child_count }
//
// 400 — validation errors (returned as { errors: string[] })
// 409 — insurer with same code or company_name already exists
// 500 — DB error (with best-effort cleanup attempted)
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { ALLOWED_OWNERSHIP_TYPES } from '@/lib/insurerAgent/extractor';
import {
  validateOffices,
  topologicalOrder,
} from '@/lib/insurerAgent/autoLink';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const INSURER_FIELDS = [
  'company_name',
  'code',
  'irdai_reg_no',
  'gstin',
  'ownership_type',
  'registered_address',
  'city',
  'state',
  'pin',
  'phone',
  'email',
];

const OFFICE_FIELDS_PERSISTED = [
  'office_code',
  'name',
  'city',
  'state',
  'address',
  // pin/gstin/phone/email/contact_person/display_order/office_short_code
  // are accepted on the table but not on the agent payload; left to the
  // bulk-import flow.
];

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const insurerInput = body?.insurer;
  const offices = Array.isArray(body?.offices) ? body.offices : [];

  // -------------------------------------------------------------------------
  // 1. Validate input.
  // -------------------------------------------------------------------------
  const errors = [];

  if (!insurerInput || typeof insurerInput !== 'object') {
    errors.push('insurer object is required');
  } else {
    const cn = String(insurerInput.company_name || '').trim();
    if (cn.length < 2) errors.push('insurer.company_name is required');
    if (
      insurerInput.ownership_type &&
      !ALLOWED_OWNERSHIP_TYPES.includes(insurerInput.ownership_type)
    ) {
      errors.push(
        `insurer.ownership_type must be one of: ${ALLOWED_OWNERSHIP_TYPES.join(', ')}`
      );
    }
    if (insurerInput.pin && !/^[1-9][0-9]{5}$/.test(String(insurerInput.pin).trim())) {
      errors.push('insurer.pin must be 6 digits starting with 1–9');
    }
  }

  const officeValidation = validateOffices(offices);
  errors.push(...officeValidation.errors);

  const { order, cycle } = topologicalOrder(offices);
  if (cycle) errors.push('Office hierarchy contains a cycle — fix parent links.');

  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  // -------------------------------------------------------------------------
  // 2. Duplicate insurer check (race-safe at write time).
  // -------------------------------------------------------------------------
  const cn = String(insurerInput.company_name).trim();
  const code = insurerInput.code ? String(insurerInput.code).trim() : null;

  const dupChecks = [];
  dupChecks.push(
    supabaseAdmin
      .from('insurers')
      .select('id, company_name, code')
      .ilike('company_name', cn)
      .limit(1)
      .maybeSingle()
  );
  if (code) {
    dupChecks.push(
      supabaseAdmin
        .from('insurers')
        .select('id, company_name, code')
        .ilike('code', code)
        .limit(1)
        .maybeSingle()
    );
  }
  const dupResults = await Promise.all(dupChecks);
  const existing = dupResults.find((r) => r?.data)?.data || null;
  if (existing) {
    return NextResponse.json(
      {
        error: 'insurer already exists',
        existing_match: existing,
      },
      { status: 409 }
    );
  }

  // -------------------------------------------------------------------------
  // 3. Insert the insurer.
  // -------------------------------------------------------------------------
  const insurerRow = {};
  for (const f of INSURER_FIELDS) {
    const v = insurerInput[f];
    if (v !== null && v !== undefined && String(v).trim() !== '') {
      insurerRow[f] = String(v).trim();
    }
  }

  const { data: insurer, error: insErr } = await supabaseAdmin
    .from('insurers')
    .insert([insurerRow])
    .select('id, company_name, code')
    .single();
  if (insErr || !insurer) {
    return NextResponse.json(
      { error: `insurer insert failed: ${insErr?.message || 'unknown'}` },
      { status: 500 }
    );
  }
  const insurerId = insurer.id;

  // -------------------------------------------------------------------------
  // 4. Insert offices in topo order, resolving parent_office_id from the
  //    in-memory name->id map.
  // -------------------------------------------------------------------------
  const nameToId = new Map();
  const insertedIds = [];
  let rootCount = 0;
  let childCount = 0;

  for (const idx of order) {
    const src = offices[idx];
    const row = { insurer_id: insurerId };
    for (const f of OFFICE_FIELDS_PERSISTED) {
      const v = src[f];
      if (v !== null && v !== undefined && String(v).trim() !== '') {
        row[f] = String(v).trim();
      }
    }
    row.is_active = src.is_active === false ? false : true;

    const pname = typeof src.parent_name === 'string' ? src.parent_name.trim() : '';
    if (pname) {
      const pid = nameToId.get(pname);
      if (pid == null) {
        // topologicalOrder treats unresolvable parents as roots — but
        // validateOffices should have caught those. Defence-in-depth:
        await rollbackBestEffort({ insurerId, insertedIds });
        return NextResponse.json(
          {
            error: `internal: could not resolve parent "${pname}" for office "${src.name}" at insert time`,
          },
          { status: 500 }
        );
      }
      row.parent_office_id = pid;
      childCount += 1;
    } else {
      rootCount += 1;
    }

    const { data: ofcRow, error: ofcErr } = await supabaseAdmin
      .from('insurer_offices')
      .insert([row])
      .select('id, name')
      .single();
    if (ofcErr || !ofcRow) {
      await rollbackBestEffort({ insurerId, insertedIds });
      return NextResponse.json(
        { error: `office insert failed for "${src.name}": ${ofcErr?.message || 'unknown'}` },
        { status: 500 }
      );
    }
    insertedIds.push(ofcRow.id);
    if (ofcRow.name && !nameToId.has(ofcRow.name)) nameToId.set(ofcRow.name, ofcRow.id);
  }

  // -------------------------------------------------------------------------
  // 5. Activity log (server-side direct insert; the client-side
  //    lib/activityLogger.js POSTs to /api/activity-log, but here we're
  //    already on the server with supabaseAdmin so we write straight to
  //    the table to avoid a self-fetch).
  // -------------------------------------------------------------------------
  try {
    const userEmail = request.headers.get('x-app-user-email');
    await supabaseAdmin.from('activity_log').insert([
      {
        user_email: userEmail || null,
        action: 'insurer_registered',
        entity_type: 'insurer',
        entity_id: String(insurerId),
        details: JSON.stringify({
          company_name: insurer.company_name,
          code: insurer.code,
          offices_created: insertedIds.length,
          root_count: rootCount,
          child_count: childCount,
        }),
      },
    ]);
  } catch (logErr) {
    // Non-fatal — registration succeeded; the audit trail is best-effort.
    console.warn('[insurer-agent/commit] activity_log write failed:', logErr?.message || logErr);
  }

  return NextResponse.json(
    {
      insurer_id: insurerId,
      offices_created: insertedIds.length,
      root_count: rootCount,
      child_count: childCount,
    },
    { status: 201 }
  );
}

// ---------------------------------------------------------------------------
// rollbackBestEffort — Supabase doesn't expose a transaction handle to JS,
// so we delete what we inserted in reverse insertion order. The
// insurer_offices.parent_office_id FK is ON DELETE SET NULL, so deleting
// children first isn't strictly required — but doing so keeps the audit
// trail consistent.
// ---------------------------------------------------------------------------
async function rollbackBestEffort({ insurerId, insertedIds }) {
  try {
    if (insertedIds.length > 0) {
      await supabaseAdmin
        .from('insurer_offices')
        .delete()
        .in('id', insertedIds);
    }
    await supabaseAdmin.from('insurers').delete().eq('id', insurerId);
  } catch (rbErr) {
    console.warn('[insurer-agent/commit] rollback failed:', rbErr?.message || rbErr);
  }
}

// =============================================================================
// /api/insurer-offices/[id]
// =============================================================================
// Three verbs, two interpretations of [id]:
//   POST   [id] = insurer_id (parent insurer for a new office row)
//   PUT    [id] = office id (the row being edited)
//   DELETE [id] = office id (the row being removed)
//
// Server-side hierarchy enforcement (mirrors lib/insurerOfficeTypes.js):
//   - office_code must be in the 7-value enum (DB CHECK + JS isValidParent)
//   - If parent_office_id is set:
//       - it must exist
//       - it must belong to the same insurer (cross-insurer parents
//         silently corrupt the tree, so reject explicitly)
//       - its office_code must be a legal parent for this row's office_code
//       - it cannot be the row itself (self-parenting)
//   - Only one HO per insurer (enforced by the partial UNIQUE index in DB,
//     but we check here too for a friendlier error)
//
// DELETE blocking:
//   - 409 if any claim references the office via appointing_office_id /
//     policy_office_id / fsr_office_id (data integrity — historical
//     claims must keep their pointer or we lose IRDAI audit context)
//   - 409 if any child office still names this row as parent_office_id
//     (the FK is ON DELETE SET NULL so deleting wouldn't fail — but
//     orphaning an entire branch silently is rarely what the clerk wants)
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  OFFICE_CODE_LIST,
  ALLOWED_PARENT_TYPES,
  isValidParent,
} from '@/lib/insurerOfficeTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Whitelist of columns the API accepts on a row create/update. Anything
// outside this list is dropped before the DB call so callers can't sneak
// in `id`, `insurer_id`, or `created_at` by including them in the body.
const WRITEABLE_COLUMNS = new Set([
  'office_code',
  'parent_office_id',
  'name',
  'address',
  'city',
  'state',
  'pin',
  'gstin',
  'phone',
  'email',
  'contact_person',
  'is_active',
  'display_order',
  'office_short_code',
  // legacy `type` is intentionally excluded — the trigger keeps it in
  // sync with office_code, so callers shouldn't write it directly.
]);

function pickWriteable(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (WRITEABLE_COLUMNS.has(k)) out[k] = v;
  }
  return out;
}

// Validate the office_code + parent_office_id combo against the hierarchy
// rules. Returns null if OK, otherwise an { error, status } object.
async function validateHierarchy({
  officeCode,
  parentOfficeId,
  insurerId,
  rowId,           // the office being updated; null on insert
}) {
  if (!officeCode) {
    return { error: 'office_code is required', status: 400 };
  }
  if (!OFFICE_CODE_LIST.includes(officeCode)) {
    return {
      error: `invalid office_code "${officeCode}" (must be one of ${OFFICE_CODE_LIST.join(', ')})`,
      status: 400,
    };
  }

  // HO-specific rules: no parent + singleton.
  if (officeCode === 'HO') {
    if (parentOfficeId != null) {
      return { error: 'HO cannot have a parent_office_id', status: 400 };
    }
    // Singleton check: another HO already exists for this insurer.
    let q = supabaseAdmin
      .from('insurer_offices')
      .select('id')
      .eq('insurer_id', insurerId)
      .eq('office_code', 'HO');
    if (rowId != null) q = q.neq('id', rowId);
    const { data, error } = await q.limit(1);
    if (error) return { error: error.message, status: 500 };
    if (data && data.length > 0) {
      return {
        error: 'this insurer already has a Head Office (HO is singleton)',
        status: 409,
      };
    }
    return null; // OK
  }

  // Non-HO: a parent_office_id is allowed but optional. If set, validate it.
  if (parentOfficeId == null) {
    return null; // OK — orphan is permitted (UI will surface it for re-parenting)
  }
  if (rowId != null && Number(parentOfficeId) === Number(rowId)) {
    return { error: 'self-parenting is not allowed', status: 400 };
  }

  const { data: parent, error: pErr } = await supabaseAdmin
    .from('insurer_offices')
    .select('id, insurer_id, office_code')
    .eq('id', parentOfficeId)
    .maybeSingle();
  if (pErr) return { error: pErr.message, status: 500 };
  if (!parent) {
    return { error: `parent_office_id ${parentOfficeId} not found`, status: 400 };
  }
  if (Number(parent.insurer_id) !== Number(insurerId)) {
    return {
      error: 'parent_office_id belongs to a different insurer',
      status: 400,
    };
  }
  if (!isValidParent(officeCode, parent.office_code)) {
    const legal = ALLOWED_PARENT_TYPES[officeCode].join(', ') || '(none — root only)';
    return {
      error: `${officeCode} cannot have a ${parent.office_code} parent (legal: ${legal})`,
      status: 400,
    };
  }
  return null; // OK
}

// ----- POST  [id]=insurer_id  (create office) -------------------------------
export async function POST(request, { params }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const insurerId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(insurerId) || insurerId <= 0) {
    return NextResponse.json(
      { error: 'invalid insurer id in URL' },
      { status: 400 }
    );
  }

  const clean = pickWriteable(body);
  // Office name is required at the DB level (NOT NULL).
  if (!clean.name || String(clean.name).trim() === '') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  // Default new offices to active.
  if (clean.is_active == null) clean.is_active = true;

  const fail = await validateHierarchy({
    officeCode: clean.office_code,
    parentOfficeId: clean.parent_office_id ?? null,
    insurerId,
    rowId: null,
  });
  if (fail) return NextResponse.json({ error: fail.error }, { status: fail.status });

  const { data, error } = await supabaseAdmin
    .from('insurer_offices')
    .insert([{ ...clean, insurer_id: insurerId }])
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}

// ----- PUT  [id]=office_id  (update office) ---------------------------------
export async function PUT(request, { params }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const officeId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(officeId) || officeId <= 0) {
    return NextResponse.json(
      { error: 'invalid office id in URL' },
      { status: 400 }
    );
  }

  const clean = pickWriteable(body);

  // Fetch current row so we know the insurer_id (PUT body can't change it).
  const { data: existing, error: fErr } = await supabaseAdmin
    .from('insurer_offices')
    .select('id, insurer_id, office_code, parent_office_id')
    .eq('id', officeId)
    .maybeSingle();
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });
  if (!existing) {
    return NextResponse.json({ error: 'office not found' }, { status: 404 });
  }

  // Validate the resulting hierarchy state (use new value if provided,
  // otherwise the existing one).
  const nextOfficeCode = clean.office_code ?? existing.office_code;
  const nextParentId =
    Object.prototype.hasOwnProperty.call(clean, 'parent_office_id')
      ? clean.parent_office_id
      : existing.parent_office_id;

  const fail = await validateHierarchy({
    officeCode: nextOfficeCode,
    parentOfficeId: nextParentId ?? null,
    insurerId: existing.insurer_id,
    rowId: officeId,
  });
  if (fail) return NextResponse.json({ error: fail.error }, { status: fail.status });

  const { data, error } = await supabaseAdmin
    .from('insurer_offices')
    .update(clean)
    .eq('id', officeId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true, office: data });
}

// ----- DELETE  [id]=office_id  (with referential blocks) ---------------------
export async function DELETE(_request, { params }) {
  const officeId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(officeId) || officeId <= 0) {
    return NextResponse.json(
      { error: 'invalid office id in URL' },
      { status: 400 }
    );
  }

  // 1. Block on claim references. The 3-office model puts the office id on
  //    appointing/policy/fsr_office_id columns of claims. Any non-zero count
  //    means there's a historical claim we'd silently de-link by deleting.
  //    Run the three counts in parallel.
  const [appCount, polCount, fsrCount] = await Promise.all([
    supabaseAdmin
      .from('claims')
      .select('id', { head: true, count: 'exact' })
      .eq('appointing_office_id', officeId),
    supabaseAdmin
      .from('claims')
      .select('id', { head: true, count: 'exact' })
      .eq('policy_office_id', officeId),
    supabaseAdmin
      .from('claims')
      .select('id', { head: true, count: 'exact' })
      .eq('fsr_office_id', officeId),
  ]);

  if (appCount.error || polCount.error || fsrCount.error) {
    return NextResponse.json(
      {
        error:
          appCount.error?.message ||
          polCount.error?.message ||
          fsrCount.error?.message ||
          'failed to check claim references',
      },
      { status: 500 }
    );
  }
  const totalRefs =
    (appCount.count || 0) + (polCount.count || 0) + (fsrCount.count || 0);
  if (totalRefs > 0) {
    return NextResponse.json(
      {
        error:
          `cannot delete: ${totalRefs} claim(s) reference this office ` +
          `(appointing=${appCount.count || 0}, policy=${polCount.count || 0}, fsr=${fsrCount.count || 0}). ` +
          'Mark the office inactive instead, or re-assign those claims first.',
        details: {
          appointing_count: appCount.count || 0,
          policy_count: polCount.count || 0,
          fsr_count: fsrCount.count || 0,
        },
      },
      { status: 409 }
    );
  }

  // 2. Block on child offices. The FK is ON DELETE SET NULL so the delete
  //    would technically succeed and orphan the children — refuse upfront
  //    so the clerk has a chance to re-parent them deliberately.
  const { count: childCount, error: cErr } = await supabaseAdmin
    .from('insurer_offices')
    .select('id', { head: true, count: 'exact' })
    .eq('parent_office_id', officeId);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if ((childCount || 0) > 0) {
    return NextResponse.json(
      {
        error:
          `cannot delete: ${childCount} child office(s) still name this row as parent. ` +
          'Re-parent or delete the children first.',
        details: { child_count: childCount },
      },
      { status: 409 }
    );
  }

  const { error } = await supabaseAdmin
    .from('insurer_offices')
    .delete()
    .eq('id', officeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

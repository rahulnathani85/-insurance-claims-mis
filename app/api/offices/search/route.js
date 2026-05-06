// =============================================================================
// /api/offices/search
// =============================================================================
// GET — Type-ahead search over insurer_offices (via the
// v_insurer_offices_with_path view so each result includes hierarchy_path
// and depth). Used by:
//   - the office picker on /claim-registration/<id> (3 office roles)
//   - the parent-office picker on /insurer-master (filtered by allowed
//     parent types via the office_code query param)
//   - the bulk-import form's "resolve parent by name" flow
//
// Query params (all optional unless noted):
//   id           - BIGINT. Single-row lookup by primary key. When set, all
//                  other filters except active_only are ignored — used by
//                  ThreeOfficePicker to refetch a previously-stored office
//                  when a claim form boots and only has the id on hand.
//   insurer_id   - BIGINT (REQUIRED on the search path; returns 400 if
//                  missing). Office search must always be scoped to a
//                  single insurer — the picker UI gates the user, but the
//                  API enforces too so a buggy code path can never leak
//                  cross-insurer offices. NOT required on the `id=` path
//                  (single-row primary-key lookup).
//   q            - free-text search; ILIKE on name OR city, case-insensitive
//   office_code  - comma-separated whitelist of codes, e.g. 'HO,RO,LCBO'
//                  Only rows whose office_code is in the list are returned.
//                  If omitted, all 7 codes are eligible.
//   active_only  - '1' (default) or '0'. When 1, hides is_active=false rows.
//                  Note: when id is set, active_only=0 is implicit so the
//                  picker can still re-display an office that has since
//                  been deactivated (UI shows it as a chip with a warning
//                  rather than silently dropping it).
//   limit        - default 25, capped at 100. Larger values are clamped down.
//
// Response (200):
//   { offices: Array<{
//       id, insurer_id, office_code, name, hierarchy_path, depth,
//       parent_office_id, city, state, address, pin, is_active,
//       office_short_code
//     }> }
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { OFFICE_CODE_LIST } from '@/lib/insurerOfficeTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Postgres ILIKE patterns treat % and _ as wildcards. The user's q comes in
// as plain text — escape these characters so a search for "M/s" or "100%"
// doesn't accidentally bring back the entire table.
function escapeIlikePattern(input) {
  return String(input)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const idRaw        = searchParams.get('id');
  const insurerIdRaw = searchParams.get('insurer_id');
  const q            = searchParams.get('q')?.trim() || '';
  const officeCodeQ  = searchParams.get('office_code');
  const activeOnlyQ  = searchParams.get('active_only');
  const limitQ       = searchParams.get('limit');

  // Single-row lookup short-circuit. When the picker boots a form with an
  // existing *_office_id but no cached row, this is how it fetches the chip
  // label without a second round-trip to /api/offices/[id]. We deliberately
  // skip active_only here — see header comment.
  if (idRaw) {
    const idNum = Number.parseInt(idRaw, 10);
    if (!Number.isFinite(idNum) || idNum <= 0) {
      return NextResponse.json(
        { error: 'id must be a positive integer' },
        { status: 400 }
      );
    }
    const { data, error } = await supabaseAdmin
      .from('v_insurer_offices_with_path')
      .select(
        'id, insurer_id, office_code, name, hierarchy_path, depth, ' +
        'parent_office_id, city, state, address, pin, is_active, office_short_code'
      )
      .eq('id', idNum)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ offices: data ? [data] : [] });
  }

  // Parse insurer_id — REQUIRED for the search path (the `id=` short-circuit
  // above doesn't need it; that path is strictly a single-row by primary key).
  // Defence-in-depth for the cross-insurer leak: even if a UI bug somewhere
  // ever passes a request with no insurer scope, the API refuses rather than
  // silently returning every insurer's offices.
  if (!insurerIdRaw || String(insurerIdRaw).trim() === '') {
    return NextResponse.json(
      { error: 'insurer_id is required — office search must be scoped to an insurer' },
      { status: 400 }
    );
  }
  const insurerIdNum = Number.parseInt(insurerIdRaw, 10);
  if (!Number.isFinite(insurerIdNum) || insurerIdNum <= 0) {
    return NextResponse.json(
      { error: 'insurer_id must be a positive integer' },
      { status: 400 }
    );
  }
  const insurerId = insurerIdNum;

  // Parse + validate office_code list. Anything not in OFFICE_CODE_LIST is
  // dropped so a typo doesn't 500 the request.
  let officeCodes = null;
  if (officeCodeQ) {
    const tokens = officeCodeQ
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    officeCodes = tokens.filter((t) => OFFICE_CODE_LIST.includes(t));
    if (officeCodes.length === 0) {
      // Caller passed a list but every entry was invalid — empty result is
      // the honest answer (rather than silently widening to "all codes").
      return NextResponse.json({ offices: [] });
    }
  }

  const activeOnly = activeOnlyQ === '0' ? false : true;

  let limit = DEFAULT_LIMIT;
  if (limitQ) {
    const n = Number.parseInt(limitQ, 10);
    if (Number.isFinite(n) && n > 0) {
      limit = Math.min(n, MAX_LIMIT);
    }
  }

  // Build the query against the view so we get hierarchy_path + depth.
  let query = supabaseAdmin
    .from('v_insurer_offices_with_path')
    .select(
      'id, insurer_id, office_code, name, hierarchy_path, depth, ' +
      'parent_office_id, city, state, address, pin, is_active, office_short_code'
    )
    .order('depth', { ascending: true })
    .order('name',  { ascending: true })
    .limit(limit);

  // insurerId is guaranteed non-null at this point — we 400'd above if
  // missing — so always apply the scope filter.
  query = query.eq('insurer_id', insurerId);
  if (officeCodes && officeCodes.length > 0) {
    query = query.in('office_code', officeCodes);
  }
  if (activeOnly) {
    query = query.eq('is_active', true);
  }
  if (q) {
    // ILIKE on name OR city. PostgREST `.or()` takes a comma-joined list of
    // single-column predicates. Wrap with %...% for substring match.
    const escaped = escapeIlikePattern(q);
    const pattern = `%${escaped}%`;
    query = query.or(`name.ilike.${pattern},city.ilike.${pattern}`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ offices: data || [] });
}

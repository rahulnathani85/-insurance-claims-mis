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
//   insurer_id   - BIGINT (required if you want the picker scoped to one
//                  insurer; in practice all callers pass it)
//   q            - free-text search; ILIKE on name OR city, case-insensitive
//   office_code  - comma-separated whitelist of codes, e.g. 'HO,RO,LCBO'
//                  Only rows whose office_code is in the list are returned.
//                  If omitted, all 7 codes are eligible.
//   active_only  - '1' (default) or '0'. When 1, hides is_active=false rows.
//   limit        - default 25, capped at 100. Larger values are clamped down.
//
// Response (200):
//   { offices: Array<{
//       id, insurer_id, office_code, name, hierarchy_path, depth,
//       parent_office_id, city, state, is_active, office_short_code
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

  const insurerIdRaw = searchParams.get('insurer_id');
  const q            = searchParams.get('q')?.trim() || '';
  const officeCodeQ  = searchParams.get('office_code');
  const activeOnlyQ  = searchParams.get('active_only');
  const limitQ       = searchParams.get('limit');

  // Parse insurer_id — required if provided, must be a positive integer.
  let insurerId = null;
  if (insurerIdRaw != null && insurerIdRaw !== '') {
    const n = Number.parseInt(insurerIdRaw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json(
        { error: 'insurer_id must be a positive integer' },
        { status: 400 }
      );
    }
    insurerId = n;
  }

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
      'parent_office_id, city, state, is_active, office_short_code'
    )
    .order('depth', { ascending: true })
    .order('name',  { ascending: true })
    .limit(limit);

  if (insurerId != null) {
    query = query.eq('insurer_id', insurerId);
  }
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

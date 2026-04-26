// ============================================================
// /api/communications/messages
// ------------------------------------------------------------
// GET — list inbox_messages, scoped by the user's company unless
// they're on a multi-company role ('All' / 'Development').
//
// Query params:
//   status   default 'received' (the triage queue). Pass 'all' for
//            every status, or any specific message_status enum value.
//   company  override (only respected if user has multi-company role).
//   limit    default 50, max 200
//   offset   default 0
//   q        optional substring search on subject + from_address
//
// Returns: {
//   total: <int>,
//   limit, offset,
//   messages: [
//     { id, source, source_msg_id, from_address, from_display,
//       subject, received_at, attachments_count, status, company,
//       has_active_classification: bool }
//   ]
// }
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MULTI_COMPANY_ROLES = new Set(['all', 'development']);

export async function GET(request) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'received';
  const companyParam = searchParams.get('company');
  const q = (searchParams.get('q') || '').trim();
  const limit = clampInt(searchParams.get('limit'), 1, MAX_LIMIT, DEFAULT_LIMIT);
  const offset = clampInt(searchParams.get('offset'), 0, 1_000_000, 0);

  // Scope by company:
  //   - Users on a specific company (NISLA / Acuere) can only see that
  //     company's messages. companyParam is ignored.
  //   - Users on a multi-company role ('All' / 'Development') default
  //     to seeing everything; companyParam optionally narrows that.
  const userCompanyKey = String(user.company || '').toLowerCase();
  const isMultiCompany = MULTI_COMPANY_ROLES.has(userCompanyKey);
  const scopeCompany = isMultiCompany ? (companyParam || null) : user.company;

  let query = supabaseAdmin
    .from('inbox_messages')
    .select(
      `id, source, source_msg_id, from_address, from_display, to_address,
       subject, received_at, attachments_count, status, company,
       triaged_by, triaged_at, dismissed_by, dismissed_at`,
      { count: 'exact' }
    );

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }
  if (scopeCompany) {
    query = query.eq('company', scopeCompany);
  }
  if (q) {
    // Postgres ilike via PostgREST .or() — search subject OR from_address.
    const safeQ = q.replace(/[%_]/g, '\\$&');
    query = query.or(`subject.ilike.%${safeQ}%,from_address.ilike.%${safeQ}%`);
  }

  query = query
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // For each message, also indicate whether it already has an active
  // classification (used by the UI to show triaged messages distinctly).
  // Single round-trip via .in().
  const ids = (data || []).map((m) => m.id);
  const classifiedSet = new Set();
  if (ids.length > 0) {
    const { data: clsRows } = await supabaseAdmin
      .from('message_classifications')
      .select('message_id')
      .in('message_id', ids)
      .eq('is_active', true);
    for (const r of clsRows || []) classifiedSet.add(r.message_id);
  }

  return NextResponse.json({
    total: count ?? (data?.length || 0),
    limit,
    offset,
    messages: (data || []).map((m) => ({
      ...m,
      has_active_classification: classifiedSet.has(m.id),
    })),
  });
}

function clampInt(raw, lo, hi, dflt) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

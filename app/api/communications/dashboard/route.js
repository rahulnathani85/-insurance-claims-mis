// ============================================================
// /api/communications/dashboard
// ------------------------------------------------------------
// Aggregated metrics for the comms pipeline. Used by
// /communications/dashboard. Multi-tenant scoped the same way
// as the messages list endpoint.
//
// Query params:
//   from   ISO date (default: today - 7 days)
//   to     ISO date (default: today)
//   company  override (multi-company roles only)
//
// Returns:
//   {
//     range: { from, to },
//     totals: {
//       total, received, classifying, pending_review,
//       auto_routed, dismissed, error
//     },
//     by_day: [{ date, received, classifying, pending_review,
//                auto_routed, dismissed, total }],
//     by_tag: [{ tag, count }]
//   }
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MULTI_COMPANY_ROLES = new Set(['all', 'development']);
const TRACKED_STATUSES = ['received', 'classifying', 'pending_review', 'auto_routed', 'dismissed', 'error'];

export async function GET(request) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  const { searchParams } = new URL(request.url);

  // Default range: trailing 7 days ending today (UTC).
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setUTCDate(today.getUTCDate() - 6);
  sevenDaysAgo.setUTCHours(0, 0, 0, 0);

  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const from = fromParam ? new Date(fromParam) : sevenDaysAgo;
  const to = toParam ? new Date(toParam) : today;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: 'invalid from/to date' }, { status: 400 });
  }
  if (!toParam) to.setUTCHours(23, 59, 59, 999);
  if (!fromParam) from.setUTCHours(0, 0, 0, 0);

  // Company scoping mirrors /api/communications/messages.
  const userCompanyKey = String(user.company || '').toLowerCase();
  const isMultiCompany = MULTI_COMPANY_ROLES.has(userCompanyKey);
  const scopeCompany = isMultiCompany ? (searchParams.get('company') || null) : user.company;

  // Single fetch of all messages in range; aggregation in JS keeps
  // the SQL surface tiny (no GROUP BY round-trips per status).
  let q = supabaseAdmin
    .from('inbox_messages')
    .select('id, status, received_at')
    .gte('received_at', from.toISOString())
    .lte('received_at', to.toISOString());
  if (scopeCompany) q = q.eq('company', scopeCompany);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const totals = { total: 0 };
  for (const s of TRACKED_STATUSES) totals[s] = 0;

  const byDayMap = new Map(); // dateStr -> { date, ...counts }

  for (const r of rows || []) {
    totals.total += 1;
    if (TRACKED_STATUSES.includes(r.status)) totals[r.status] += 1;

    const day = (r.received_at || '').slice(0, 10); // YYYY-MM-DD
    if (!day) continue;
    if (!byDayMap.has(day)) {
      const empty = { date: day, total: 0 };
      for (const s of TRACKED_STATUSES) empty[s] = 0;
      byDayMap.set(day, empty);
    }
    const slot = byDayMap.get(day);
    slot.total += 1;
    if (TRACKED_STATUSES.includes(r.status)) slot[r.status] += 1;
  }

  const by_day = [...byDayMap.values()].sort((a, b) => (a.date < b.date ? 1 : -1));

  // Tag distribution via active classifications. We restrict to
  // messages whose received_at is in range to keep the join tight.
  //
  // IMPORTANT: chunk the .in() filter. Supabase encodes .in() as a
  // URL filter, and large id lists (a few hundred UUIDs) exceed the
  // PostgREST URL length cap and silently drop ids — leading to
  // undercounted by_tag totals on the dashboard. Fetch in batches of
  // 100 and merge.
  let by_tag = [];
  const ids = (rows || []).map((r) => r.id);
  if (ids.length > 0) {
    const tagCounts = new Map();
    const CHUNK = 100;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { data: clsRows } = await supabaseAdmin
        .from('message_classifications')
        .select('tag')
        .in('message_id', slice)
        .eq('is_active', true);
      for (const r of clsRows || []) {
        tagCounts.set(r.tag, (tagCounts.get(r.tag) || 0) + 1);
      }
    }
    by_tag = [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  return NextResponse.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    totals,
    by_day,
    by_tag,
  });
}

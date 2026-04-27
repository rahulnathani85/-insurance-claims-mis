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
import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MULTI_COMPANY_ROLES = new Set(['all', 'development']);

// Tag groups — mirror the seed in tag_definitions. Used by the
// 'extraction' / 'non_extraction' category filters which join the
// inbox_messages query against an active classification with a tag
// in one of these sets.
const EXTRACTION_TAGS = [
  'intimation', 'client_followup', 'insurer_query', 'policy_doc',
  'claim_documents', 'surveyor_photos', 'claim_registration',
  'settlement_advice', 'consent_email',
];
const NON_EXTRACTION_TAGS = [
  'internal_admin', 'duplicate', 'update_from_insurer', 'others',
];

export async function GET(request) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  const { searchParams } = new URL(request.url);
  // 'category' is the new high-level filter the UI uses. 'status' is
  // kept for backward compatibility (older callers / direct API users).
  // Categories:
  //   all              — no filter
  //   unattended       — status='received'
  //   dismissed        — status='dismissed'
  //   auto_routed      — status='auto_routed'
  //   extraction       — active classification's tag is in EXTRACTION_TAGS
  //                      AND status in ('classifying','pending_review')
  //   non_extraction   — same but tag in NON_EXTRACTION_TAGS
  const category = (searchParams.get('category') || '').toLowerCase();
  // 'tag' is a single workflow_tag filter — when set, returns messages
  // whose active classification matches that tag, regardless of status
  // (so a drilldown from the dashboard catches classifying / pending /
  // auto-routed in one view).
  const tagFilter = (searchParams.get('tag') || '').trim();
  const status = searchParams.get('status') || (category || tagFilter ? null : 'received');
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

  // Map category → status / tag filters. Tag-group categories
  // (extraction / non_extraction) require a JOIN with
  // message_classifications, which we do as a two-pass query: first
  // collect message_ids whose active classification has a matching tag,
  // then filter inbox_messages by that id list.
  let preFilterIds = null;
  let categoryStatusList = null;

  if (category === 'unattended') {
    categoryStatusList = ['received'];
  } else if (category === 'dismissed') {
    categoryStatusList = ['dismissed'];
  } else if (category === 'auto_routed') {
    categoryStatusList = ['auto_routed'];
  } else if (category === 'extraction' || category === 'non_extraction') {
    const tags = category === 'extraction' ? EXTRACTION_TAGS : NON_EXTRACTION_TAGS;
    const { data: clsRows } = await supabase
      .from('message_classifications')
      .select('message_id')
      .eq('is_active', true)
      .in('tag', tags);
    preFilterIds = (clsRows || []).map((r) => r.message_id);
    categoryStatusList = ['classifying', 'pending_review', 'auto_routed'];
    if (preFilterIds.length === 0) {
      // No matching classifications — short-circuit to empty result.
      return NextResponse.json({ total: 0, limit, offset, messages: [] });
    }
  } else if (category === 'pending_review') {
    categoryStatusList = ['pending_review'];
  } else if (category === 'classifying') {
    categoryStatusList = ['classifying'];
  }

  // Tag drilldown — narrows preFilterIds further. When category is
  // also a tag-group filter, the resulting set is the intersection of
  // both ID lists.
  if (tagFilter) {
    const { data: clsRows } = await supabase
      .from('message_classifications')
      .select('message_id')
      .eq('is_active', true)
      .eq('tag', tagFilter);
    const tagIds = (clsRows || []).map((r) => r.message_id);
    if (tagIds.length === 0) {
      return NextResponse.json({ total: 0, limit, offset, messages: [] });
    }
    if (preFilterIds) {
      const tagSet = new Set(tagIds);
      preFilterIds = preFilterIds.filter((id) => tagSet.has(id));
      if (preFilterIds.length === 0) {
        return NextResponse.json({ total: 0, limit, offset, messages: [] });
      }
    } else {
      preFilterIds = tagIds;
      // Default to any post-triage state when no category is selected.
      if (!categoryStatusList) {
        categoryStatusList = ['classifying', 'pending_review', 'auto_routed'];
      }
    }
  }

  let query = supabase
    .from('inbox_messages')
    .select(
      `id, source, source_msg_id, from_address, from_display, to_address,
       subject, received_at, attachments_count, status, company,
       triaged_by, triaged_at, dismissed_by, dismissed_at`,
      { count: 'exact' }
    );

  if (categoryStatusList) {
    query = query.in('status', categoryStatusList);
  } else if (status && status !== 'all') {
    query = query.eq('status', status);
  }
  if (preFilterIds) {
    query = query.in('id', preFilterIds);
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

  // For each message, also fetch the active classification's tag so the
  // UI can render an action-specific badge (e.g. "Categorised - Extraction"
  // vs "Categorised - Non Extraction"). Single round-trip via .in().
  const ids = (data || []).map((m) => m.id);
  const tagByMessage = new Map();
  if (ids.length > 0) {
    const { data: clsRows } = await supabase
      .from('message_classifications')
      .select('message_id, tag')
      .in('message_id', ids)
      .eq('is_active', true);
    for (const r of clsRows || []) tagByMessage.set(r.message_id, r.tag);
  }

  return NextResponse.json({
    total: count ?? (data?.length || 0),
    limit,
    offset,
    messages: (data || []).map((m) => ({
      ...m,
      has_active_classification: tagByMessage.has(m.id),
      active_tag: tagByMessage.get(m.id) || null,
    })),
  });
}

function clampInt(raw, lo, hi, dflt) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

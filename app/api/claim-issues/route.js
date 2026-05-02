// =============================================================================
// /api/claim-issues
// =============================================================================
// Slice 10 — list + create issues for a claim.
//
// GET    ?claim_id=<id>&status=<open|resolved|dismissed|all>
//        Lists issues for a claim. Defaults to status=open.
//        Sorted by severity (error first), then created_at desc.
//
// POST   { claim_id, severity?, code, field?, message, detail?, source_type?, source_id? }
//        Creates an issue. severity defaults to 'warn',
//        source_type defaults to 'manual'.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireSurveyorRequest } from '@/lib/auth/insurer';

const VALID_SEVERITY = new Set(['info', 'warn', 'error']);
const VALID_STATUS = new Set(['open', 'resolved', 'dismissed', 'all']);
const VALID_SOURCE = new Set(['manual', 'ai', 'provenance']);

const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claimId = searchParams.get('claim_id');
  const status = (searchParams.get('status') || 'open').toLowerCase();

  if (!claimId) {
    return NextResponse.json({ error: 'claim_id is required' }, { status: 400 });
  }
  if (!VALID_STATUS.has(status)) {
    return NextResponse.json({ error: `status must be one of: ${Array.from(VALID_STATUS).join(', ')}` }, { status: 400 });
  }

  let q = supabaseAdmin
    .from('claim_issues')
    .select('*')
    .eq('claim_id', claimId);
  if (status !== 'all') q = q.eq('status', status);
  q = q.order('created_at', { ascending: false });

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Sort by severity in JS so error > warn > info regardless of created_at.
  const sorted = (data || []).slice().sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity] ?? 3;
    const sb = SEVERITY_ORDER[b.severity] ?? 3;
    if (sa !== sb) return sa - sb;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  return NextResponse.json(sorted);
}

export async function POST(request) {
  // Phase 2 mutation guard
  try {
    await requireSurveyorRequest(request);
  } catch (e) {
    if (e?.code === 'INSURER_FORBIDDEN') {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    throw e;
  }

  const body = await request.json().catch(() => ({}));

  const claimId = body?.claim_id;
  const code = (body?.code || '').trim();
  const message = (body?.message || '').trim();

  if (!claimId) return NextResponse.json({ error: 'claim_id is required' }, { status: 400 });
  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 });
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 });

  const severity = (body?.severity || 'warn').toLowerCase();
  if (!VALID_SEVERITY.has(severity)) {
    return NextResponse.json({ error: `severity must be one of: ${Array.from(VALID_SEVERITY).join(', ')}` }, { status: 400 });
  }

  const sourceType = (body?.source_type || 'manual').toLowerCase();
  if (!VALID_SOURCE.has(sourceType)) {
    return NextResponse.json({ error: `source_type must be one of: ${Array.from(VALID_SOURCE).join(', ')}` }, { status: 400 });
  }

  const row = {
    claim_id: claimId,
    severity,
    code,
    field: typeof body?.field === 'string' ? body.field.trim() || null : null,
    message,
    detail: body?.detail ?? null,
    source_type: sourceType,
    source_id: typeof body?.source_id === 'string' ? body.source_id : null,
    created_by: typeof body?.created_by === 'string' ? body.created_by : null,
  };

  const { data, error } = await supabaseAdmin
    .from('claim_issues')
    .insert([row])
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json(data, { status: 201 });
}

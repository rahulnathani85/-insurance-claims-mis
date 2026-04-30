// =============================================================================
// /api/claims/[id]/ila-drafts
// =============================================================================
// GET  — list ILA drafts for a claim, newest version first
// POST — create a new draft. Auto-versions (max version + 1). Seeds the
//        documents_required array from the LOB checklist if the body
//        doesn't supply one.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { defaultChecklistFor, sanitiseDraftPayload } from '@/lib/ila';

export async function GET(_request, { params }) {
  const { id } = params;
  const { data, error } = await supabaseAdmin
    .from('ila_drafts')
    .select('*')
    .eq('claim_id', id)
    .order('version', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(request, { params }) {
  const { id } = params;
  const body = await request.json().catch(() => ({}));

  // Confirm claim exists + pull LOB for the default checklist.
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from('claims')
    .select('id, lob, ref_number')
    .eq('id', id)
    .single();
  if (claimErr || !claim) {
    return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  }

  // Auto-version: max(existing) + 1
  const { data: maxRow } = await supabaseAdmin
    .from('ila_drafts')
    .select('version')
    .eq('claim_id', id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (maxRow?.version || 0) + 1;

  let payload;
  try {
    payload = sanitiseDraftPayload(body, { skipUndefined: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const insert = {
    claim_id: parseInt(id, 10),
    version: nextVersion,
    documents_required: payload.documents_required || defaultChecklistFor(claim.lob),
    cover_data: payload.cover_data || {},
    preliminary_view: payload.preliminary_view ?? null,
    admissibility_opinion: payload.admissibility_opinion ?? null,
    admissibility_reasoning: payload.admissibility_reasoning ?? null,
    preliminary_estimate: payload.preliminary_estimate ?? null,
    estimate_basis: payload.estimate_basis ?? null,
    next_steps: payload.next_steps ?? null,
    expected_fsr_date: payload.expected_fsr_date ?? null,
    observations: payload.observations ?? null,
    drafted_by: payload.drafted_by ?? body.drafted_by ?? 'human',
    status: payload.status || 'draft',
    created_by: body.created_by || null,
    updated_by: body.created_by || null,
  };

  const { data, error } = await supabaseAdmin
    .from('ila_drafts')
    .insert([insert])
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

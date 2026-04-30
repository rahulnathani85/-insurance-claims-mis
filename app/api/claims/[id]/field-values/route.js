// =============================================================================
// /api/claims/[id]/field-values
// =============================================================================
// GET — list current values for a claim (or a single field with ?field=...)
// POST — submit a new value, run the decision engine, apply the resulting
//        action transactionally.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  buildFieldValue,
  decideFieldAction,
  loadAuthorityRankForField,
  loadChangePolicy,
  getCurrentFieldValue,
} from '@/lib/provenance';

export const runtime = 'nodejs';

export async function GET(request, { params }) {
  const { id } = params;
  const { searchParams } = new URL(request.url);
  const field = searchParams.get('field');

  let query = supabaseAdmin
    .from('v_current_claim_fields')
    .select('*')
    .eq('claim_id', id);
  if (field) query = query.eq('field_name', field);

  const { data, error } = await query.order('field_name', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

// POST body:
//   {
//     field_name: 'sum_insured',
//     kind: 'money' | 'date' | 'string' | ...      (FieldValue kind)
//     input: any                                    (passed to buildFieldValue)
//     source_type: 'manual' | 'document' | 'email' | 'computed' | 'external_api'
//     source_document_type: 'policy_schedule' | 'fir' | ...
//     source_label: 'human-readable description'
//     source_id?: uuid (optional FK to source row)
//     extracted_by: 'ocr+sonnet@v2' | 'human:user_email' | 'system:rule_v1'
//     extraction_confidence?: number 0..1
//     captured_by?: user email
//   }
export async function POST(request, { params }) {
  const { id } = params;
  const body = await request.json().catch(() => ({}));

  const required = ['field_name', 'kind', 'source_type', 'source_label', 'extracted_by'];
  for (const k of required) {
    if (!body[k]) return NextResponse.json({ error: `${k} is required` }, { status: 400 });
  }

  // 1. Build typed value.
  let valueObj;
  try {
    valueObj = buildFieldValue(body.kind, body.input);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  // 2. Load decision context (current value + authority + policy).
  const [authorityRank, policy, current] = await Promise.all([
    loadAuthorityRankForField(supabaseAdmin, body.field_name),
    loadChangePolicy(supabaseAdmin),
    getCurrentFieldValue(supabaseAdmin, id, body.field_name),
  ]);

  // 3. Decide.
  const decision = decideFieldAction({
    fieldName: body.field_name,
    newValue: valueObj.value,
    newSource: {
      documentType: body.source_document_type || 'unknown',
      label: body.source_label,
      type: body.source_type,
    },
    newConfidence: typeof body.extraction_confidence === 'number' ? body.extraction_confidence : null,
    current: current ? {
      value: current.value,
      sourceDocumentType: current.source_document_type,
    } : null,
    authorityRank,
    policy,
  });

  // 4. Apply: insert the new evidence row, set is_current/conflict status
  // based on the decision.
  const newRow = {
    claim_id: parseInt(id, 10),
    field_name: body.field_name,
    value: valueObj.value,
    value_normalized: valueObj.normalized,
    source_type: body.source_type,
    source_id: body.source_id || null,
    source_document_type: body.source_document_type || null,
    source_label: body.source_label,
    extracted_by: body.extracted_by,
    extraction_confidence: typeof body.extraction_confidence === 'number'
      ? body.extraction_confidence
      : null,
    captured_by: body.captured_by || null,
    is_current: false,
    conflict_status: null,
    conflict_reason: null,
  };

  if (decision.kind === 'auto_update_safe') {
    newRow.is_current = true;
  } else if (decision.kind === 'raise_conflict') {
    newRow.conflict_status = 'pending';
    newRow.conflict_raised_at = new Date().toISOString();
    newRow.conflict_reason = decision.reason;
  }
  // corroborate / ignore_lower_authority → row is just evidence, is_current=false

  // For auto_update we need to mark the OLD current=false BEFORE inserting
  // the new is_current=true (unique partial index).
  if (decision.kind === 'auto_update_safe' && current) {
    await supabaseAdmin
      .from('claim_field_values')
      .update({
        is_current: false,
        superseded_at: new Date().toISOString(),
        superseded_reason: decision.reason,
      })
      .eq('id', current.id);
  }

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('claim_field_values')
    .insert([newRow])
    .select()
    .single();
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 400 });
  }

  // For auto_update, link superseded_by on the old row.
  if (decision.kind === 'auto_update_safe' && current) {
    await supabaseAdmin
      .from('claim_field_values')
      .update({ superseded_by: inserted.id })
      .eq('id', current.id);
  }

  return NextResponse.json({
    ok: true,
    decision,
    row: inserted,
  }, { status: 201 });
}

// =============================================================================
// /api/claims/[id]/loss-sheet
// =============================================================================
// GET — fetch the claim's loss sheet (creates one if absent) + all line items.
//        Always returns a hydrated { sheet, items, summary } shape so the UI
//        can render without separate calls.
// PUT — update header fields (sum_insured, excess_amount, status, notes).
//        Recomputes summary fields based on existing items.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { summariseLossSheet } from '@/lib/lossSheet';

export const runtime = 'nodejs';

export async function GET(_request, { params }) {
  const { id } = params;

  // Confirm claim exists. claims doesn't have a sum_insured column on the
  // live schema (it lives on policies); the surveyor enters SI on the
  // loss-sheet header directly.
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from('claims')
    .select('id, ref_number, lob, company')
    .eq('id', id)
    .single();
  if (claimErr || !claim) {
    return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  }

  // Look up loss sheet — auto-create if missing.
  let sheet;
  {
    const { data: existing } = await supabaseAdmin
      .from('loss_sheets')
      .select('*')
      .eq('claim_id', id)
      .maybeSingle();
    if (existing) {
      sheet = existing;
    } else {
      const { data: created, error: createErr } = await supabaseAdmin
        .from('loss_sheets')
        .insert([{
          claim_id: parseInt(id, 10),
          sum_insured: null,
          excess_amount: 0,
          company: claim.company || 'NISLA',
        }])
        .select()
        .single();
      if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });
      sheet = created;
    }
  }

  const { data: items, error: itemsErr } = await supabaseAdmin
    .from('loss_sheet_items')
    .select('*')
    .eq('loss_sheet_id', sheet.id)
    .order('item_no', { ascending: true });
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });

  const summary = summariseLossSheet({
    items: items || [],
    sum_insured: sheet.sum_insured,
    excess_amount: sheet.excess_amount,
  });

  return NextResponse.json({ sheet, items: items || [], summary });
}

export async function PUT(request, { params }) {
  const { id } = params;
  const body = await request.json().catch(() => ({}));

  const updates = {};
  if (body.sum_insured !== undefined) updates.sum_insured = numericOrNull(body.sum_insured);
  if (body.excess_amount !== undefined) updates.excess_amount = Math.max(0, Number(body.excess_amount) || 0);
  if (body.status !== undefined) {
    const valid = ['draft', 'under_review', 'approved', 'superseded'];
    if (!valid.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of: ${valid.join(', ')}` }, { status: 400 });
    }
    updates.status = body.status;
  }
  if (body.notes !== undefined) updates.notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 5000) : null;
  if (body.updated_by !== undefined) updates.updated_by = body.updated_by;

  // Recompute summary using whatever the new SI/excess will be.
  const { data: existing } = await supabaseAdmin
    .from('loss_sheets')
    .select('*')
    .eq('claim_id', id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: 'Loss sheet not found — call GET first to auto-create' }, { status: 404 });
  }

  const merged = { ...existing, ...updates };
  const { data: items } = await supabaseAdmin
    .from('loss_sheet_items')
    .select('*')
    .eq('loss_sheet_id', existing.id);
  const summary = summariseLossSheet({
    items: items || [],
    sum_insured: merged.sum_insured,
    excess_amount: merged.excess_amount,
  });

  updates.value_at_risk = summary.value_at_risk;
  updates.gross_loss = summary.gross_loss;
  updates.underinsurance_factor = summary.underinsurance_factor;
  updates.adjusted_loss = summary.adjusted_loss;
  updates.net_payable = summary.net_payable;
  updates.updated_at = new Date().toISOString();

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('loss_sheets')
    .update(updates)
    .eq('id', existing.id)
    .select()
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

  return NextResponse.json({ sheet: updated, items: items || [], summary });
}

function numericOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// =============================================================================
// /api/claims/[id]/with-provenance
// =============================================================================
// GET — Phase C read endpoint (provenance-conflict-system-spec.md §10).
//
// Returns the claim merged with its current provenance overlay so callers
// don't need to know whether a value came from the legacy column or
// claim_field_values.
//
// Response shape:
//   {
//     claim:        full legacy row,
//     provenance:   { field_name: { value, source_*, confidence, has_pending_conflict } },
//     merged:       claim row with provenance overrides applied (callers
//                   migrated to read this instead of `claim`),
//     data_quality: { score, mandatory_filled, mandatory_total, conflicts },
//   }
//
// During Phase C rollout, individual claim screens migrate one at a time
// from `/api/claims/[id]` (legacy column-only read) to this endpoint. After
// 30 days clean on Phase C the legacy columns can be dropped (Phase D).
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getClaimWithProvenance } from '@/lib/provenance';

export const runtime = 'nodejs';

export async function GET(_request, { params }) {
  const { id } = params;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  try {
    const out = await getClaimWithProvenance(supabaseAdmin, id);
    return NextResponse.json(out);
  } catch (e) {
    const msg = e?.message || String(e);
    const status = msg.startsWith('Claim not found') ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

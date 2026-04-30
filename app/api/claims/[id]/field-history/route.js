// =============================================================================
// /api/claims/[id]/field-history?field=<field_name>
// =============================================================================
// GET — Full evidence trail for a single field on a claim, newest first.
// Used by the <FieldWithProvenance> history pane (spec §9).
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getFieldHistory } from '@/lib/provenance';

export async function GET(request, { params }) {
  const { id } = params;
  const { searchParams } = new URL(request.url);
  const field = searchParams.get('field');
  if (!field) return NextResponse.json({ error: 'field query param is required' }, { status: 400 });

  try {
    const rows = await getFieldHistory(supabaseAdmin, id, field);
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

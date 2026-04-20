// =============================================================================
// /app/api/lifecycle/[lifecycle_id]/items/route.js
// =============================================================================
// POST — open a new pending item
// GET  — list items for a lifecycle (filter by status optional)
// =============================================================================

import { openItem } from '@/lib/lifecycleEngine';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(request, { params }) {
  try {
    const body = await request.json();
    const item = await openItem({
      lifecycleId: parseInt(params.lifecycle_id, 10),
      itemCatalogId: body.item_catalog_id || null,
      customItem: body.custom_item || null,
      pendingWith: body.pending_with,
      pendingWithLabel: body.pending_with_label,
      expectedBy: body.expected_by,
      notes: body.notes,
      userEmail: body.user_email,
    });
    return Response.json({ ok: true, item });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}

export async function GET(request, { params }) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  try {
    let q = supabaseAdmin.from('claim_lifecycle_items').select('*')
      .eq('claim_lifecycle_id', parseInt(params.lifecycle_id, 10))
      .order('created_at');
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return Response.json({ items: data });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}

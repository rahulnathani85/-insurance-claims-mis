// =============================================================================
// /app/api/lifecycle/items/catalog/route.js
// =============================================================================
// GET  — list all item types in the catalog
// POST — add new item type to catalog
// =============================================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request) {
  const { data, error } = await supabaseAdmin
    .from('lifecycle_item_catalog').select('*')
    .eq('is_active', true)
    .order('category, item_name');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ items: data });
}

export async function POST(request) {
  const body = await request.json();
  const { data, error } = await supabaseAdmin
    .from('lifecycle_item_catalog')
    .insert({
      item_code: body.item_code,
      item_name: body.item_name,
      description: body.description,
      category: body.category,
      default_pending_with: body.default_pending_with,
      firm_clock_behaviour: body.firm_clock_behaviour || 'pause',
      insurer_clock_behaviour: body.insurer_clock_behaviour || 'run',
      evidence_description: body.evidence_description,
      reminder_schedule_days: body.reminder_schedule_days || [7, 14, 21, 28],
    })
    .select().single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ item: data });
}

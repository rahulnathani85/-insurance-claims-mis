// =============================================================================
// /app/api/lifecycle/items/[id]/close/route.js
// =============================================================================
// POST — mark a pending item received/closed
// =============================================================================

import { closeItem } from '@/lib/lifecycleEngine';

export async function POST(request, { params }) {
  try {
    const body = await request.json();
    const result = await closeItem({
      itemId: parseInt(params.id, 10),
      evidenceUrl: body.evidence_url,
      notes: body.notes,
      userEmail: body.user_email,
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}

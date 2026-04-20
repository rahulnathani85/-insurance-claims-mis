// =============================================================================
// /app/api/lifecycle/stage/[id]/advance/route.js
// =============================================================================
// POST — mark a stage complete. Handles branching and phase roll-up.
//
// Body: { outcome?, notes?, user_email }
// =============================================================================

import { advanceStage } from '@/lib/lifecycleEngine';

export async function POST(request, { params }) {
  try {
    const body = await request.json();
    const result = await advanceStage({
      claimStageId: parseInt(params.id, 10),
      outcome: body.outcome || null,
      notes: body.notes || null,
      userEmail: body.user_email,
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}

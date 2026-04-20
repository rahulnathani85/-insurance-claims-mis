// =============================================================================
// /app/api/lifecycle/[lifecycle_id]/reopen/route.js
// =============================================================================
// POST — re-open a claim to a target phase after Delivery
//
// Body: { target_phase: 1-7, reason: string, user_email: string }
// =============================================================================

import { reopenClaim } from '@/lib/lifecycleEngine';

export async function POST(request, { params }) {
  try {
    const body = await request.json();
    const result = await reopenClaim({
      lifecycleId: parseInt(params.lifecycle_id, 10),
      targetPhase: parseInt(body.target_phase, 10),
      reason: body.reason,
      userEmail: body.user_email,
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}

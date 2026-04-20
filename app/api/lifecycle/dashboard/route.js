// =============================================================================
// /app/api/lifecycle/dashboard/route.js
// =============================================================================
// GET — dashboard bucketing. Returns counts per universal phase per company
//       plus TAT breach counts.
//
// Replaces /api/dashboard-stats for the lifecycle portion.
// =============================================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request) {
  const url = new URL(request.url);
  const company = url.searchParams.get('company');

  try {
    // Phase bucketing
    const { data: phaseBuckets } = await supabaseAdmin
      .from('v_claim_lifecycle_overview').select('current_phase, is_complete');

    const byPhase = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
    let completed = 0, open = 0;
    for (const row of (phaseBuckets || [])) {
      if (row.is_complete) completed++;
      else {
        open++;
        byPhase[row.current_phase] = (byPhase[row.current_phase] || 0) + 1;
      }
    }

    // TAT breaches
    const { data: breaches } = await supabaseAdmin
      .from('v_claim_lifecycle_tat_breaches').select('*');

    return Response.json({
      open,
      completed,
      by_phase: byPhase,
      breaches: breaches || [],
      breach_count: (breaches || []).length,
    });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}

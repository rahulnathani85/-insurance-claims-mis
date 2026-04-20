// =============================================================================
// /app/api/lifecycle/init/route.js
// =============================================================================
// POST — called by /api/claims and /api/ew-claims POST handlers to instantiate
// a lifecycle when a new claim is registered. Replaces the inline stage-insertion
// code in both those routes.
//
// Body: {
//   claim_id?: number,       // one of these two required
//   ew_claim_id?: number,
//   claim_attributes: {
//     lob, policy_type, cause_of_loss, subject_matter,
//     portfolio, client, size_band, nature, appointment_source,
//     date_of_intimation
//   },
//   user_email: string
// }
// =============================================================================

import { instantiateLifecycle } from '@/lib/lifecycleEngine';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(request) {
  try {
    const body = await request.json();
    const { claim_id, ew_claim_id, claim_attributes, user_email } = body;

    if (!claim_id && !ew_claim_id) {
      return Response.json({ error: 'claim_id or ew_claim_id required' }, { status: 400 });
    }
    if (!claim_attributes || !claim_attributes.lob) {
      return Response.json({ error: 'claim_attributes.lob required' }, { status: 400 });
    }

    const lifecycle = await instantiateLifecycle({
      claimId: claim_id || null,
      ewClaimId: ew_claim_id || null,
      claimAttributes: claim_attributes,
      userEmail: user_email,
    });

    // Flag the claim row to indicate engine usage
    if (claim_id) {
      await supabaseAdmin.from('claims').update({ uses_lifecycle_engine: true }).eq('id', claim_id);
    } else {
      await supabaseAdmin.from('ew_vehicle_claims').update({ uses_lifecycle_engine: true }).eq('id', ew_claim_id);
    }

    return Response.json({ ok: true, lifecycle_id: lifecycle.id, template_id: lifecycle.template_id });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}

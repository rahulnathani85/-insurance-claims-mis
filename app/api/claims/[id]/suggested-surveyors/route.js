// =============================================================================
// /api/claims/[id]/suggested-surveyors
// =============================================================================
// GET — returns top-N surveyors ranked for this claim, plus the blocked list
// (for transparency). Pure ranking lives in lib/assignmentRanking.js.
//
// Query params:
//   limit            number   default 5
//   allow_conflicted bool     'true' to include conflicted surveyors anyway
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { decorateSurveyor } from '@/lib/surveyors';
import { rankSurveyors, SUGGESTION_TOP_N } from '@/lib/assignmentRanking';

export async function GET(request, { params }) {
  const { id } = params;
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || String(SUGGESTION_TOP_N), 10);
  const allowConflicted = searchParams.get('allow_conflicted') === 'true';

  // Pull claim, surveyors, conflicts, current workload (active assignments per
  // surveyor) in parallel.
  const today = new Date();
  const [claimRes, surveyorsRes, conflictsRes, workloadRes] = await Promise.all([
    supabaseAdmin
      .from('claims')
      .select('id, lob, peril_type, insurer_name, insured_name, broker_name, loss_location, loss_location_state')
      .eq('id', id)
      .single(),
    supabaseAdmin
      .from('surveyors')
      .select('*')
      .eq('active', true),
    supabaseAdmin
      .from('surveyor_conflicts')
      .select('*'),
    supabaseAdmin
      .from('claim_assignments')
      .select('surveyor_id, status')
      .neq('status', 'Completed')
      .not('surveyor_id', 'is', null),
  ]);

  if (claimRes.error || !claimRes.data) {
    return NextResponse.json({ error: claimRes.error?.message || 'claim not found' }, { status: 404 });
  }

  const surveyors = (surveyorsRes.data || []).map((row) => decorateSurveyor(row, today));

  const workloads = {};
  for (const a of workloadRes.data || []) {
    if (!a.surveyor_id) continue;
    workloads[a.surveyor_id] = (workloads[a.surveyor_id] || 0) + 1;
  }

  const ranked = rankSurveyors({
    claim: claimRes.data,
    surveyors,
    conflicts: conflictsRes.data || [],
    workloads,
    today,
    options: { allowConflicted },
  });

  return NextResponse.json({
    claim_id: id,
    eligible: ranked.eligible.slice(0, limit),
    blocked:  ranked.blocked,
    total_active_surveyors: surveyors.length,
  });
}

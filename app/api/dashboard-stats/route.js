import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company');
  const isAll = !company || company === 'All';

  // --- Claims counts ---
  let baseQuery = () => {
    let q = supabase.from('claims').select('*', { count: 'exact', head: true });
    if (!isAll) q = q.eq('company', company);
    if (isAll) q = q.neq('company', 'Development');
    return q;
  };

  const { count: total } = await baseQuery();

  // --- LOB distribution ---
  let lobQuery = supabase.from('claims').select('lob');
  if (!isAll) lobQuery = lobQuery.eq('company', company);
  if (isAll) lobQuery = lobQuery.neq('company', 'Development');
  const { data: claimsForLob } = await lobQuery;
  const lobCounts = {};
  (claimsForLob || []).forEach(c => { lobCounts[c.lob] = (lobCounts[c.lob] || 0) + 1; });
  const lob_distribution = Object.entries(lobCounts)
    .map(([lob, count]) => ({ lob, count }))
    .sort((a, b) => b.count - a.count);

  // --- Workflow-based dashboard categories ---
  // Fetch all workflow stages to determine claim status by lifecycle progress
  let wfQuery = supabase.from('claim_workflow').select('claim_id, stage_number, stage_name, status');
  if (!isAll) wfQuery = wfQuery.eq('company', company);
  if (isAll) wfQuery = wfQuery.neq('company', 'Development');
  const { data: allWorkflow } = await wfQuery;

  // Group workflow stages by claim
  const claimStages = {};
  (allWorkflow || []).forEach(w => {
    if (!claimStages[w.claim_id]) claimStages[w.claim_id] = [];
    claimStages[w.claim_id].push(w);
  });

  // Determine category for each claim based on its highest completed stage
  // Stage mapping:
  //   Survey Completed (5) → Open Claims (survey work done)
  //   LOR Sent (6) or ILA Issued (7) → In Process (LOR/ILA sent)
  //   Documents Received (13) not completed → Documents Pending
  //   Assessment Shared (17) or Consent Received (18) completed → Assessment Shared / Consent
  //   Report Dispatched (21) completed → Report Submitted

  let openClaims = 0;       // Survey completed
  let inProcess = 0;        // LOR / ILA sent
  let docsPending = 0;      // Documents still awaited
  let assessmentShared = 0; // Assessment shared or consent received
  let reportSubmitted = 0;  // Report dispatched

  const claimIds = Object.keys(claimStages);

  claimIds.forEach(claimId => {
    const stages = claimStages[claimId];
    const completedStages = new Set();
    stages.forEach(s => {
      if (s.status === 'Completed') completedStages.add(s.stage_number);
    });

    // Determine category by highest milestone reached (check from highest to lowest)
    if (completedStages.has(21)) {
      // Report Dispatched = Report Submitted
      reportSubmitted++;
    } else if (completedStages.has(17) || completedStages.has(18)) {
      // Assessment Shared or Consent Received
      assessmentShared++;
    } else if (completedStages.has(13)) {
      // Documents received — in process beyond docs
      // Check if LOR/ILA sent but still working on report
      inProcess++;
    } else if (completedStages.has(6) || completedStages.has(7)) {
      // LOR or ILA sent but documents not yet received = Documents Pending
      docsPending++;
    } else if (completedStages.has(5)) {
      // Survey completed but LOR/ILA not yet sent = Open (survey done)
      openClaims++;
    } else {
      // Early stages (intimation, registration, surveyor assigned) or no workflow
      openClaims++;
    }
  });

  // Claims without any workflow = count them as open
  const claimsWithWorkflow = claimIds.length;
  const claimsWithoutWorkflow = (total || 0) - claimsWithWorkflow;
  openClaims += claimsWithoutWorkflow;

  return NextResponse.json({
    total_claims: total || 0,
    open_claims: openClaims,
    in_process_claims: inProcess,
    docs_pending: docsPending,
    assessment_shared: assessmentShared,
    report_submitted: reportSubmitted,
    lob_distribution,
  });
}

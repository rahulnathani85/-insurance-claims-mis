// =============================================================================
// /api/claims/[id]/team-assign
// =============================================================================
// POST — bulk-create claim_assignments rows for a list of (surveyor_id, role)
// pairs. Used by the registration form's team-mode flow (registration spec
// §7).
//
// Body:
//   {
//     assignments: [
//       { surveyor_id: 'uuid', role: 'lead_surveyor', notes?: 'string',
//         allow_conflicted?: false }
//     ],
//     assigned_by: 'email',
//     company?: 'NISLA' | 'Acuere',
//   }
//
// Validation:
//   - exactly one lead_surveyor (per spec §3 / §9)
//   - all roles in ASSIGNMENT_ROLES
//   - all surveyors must be eligible per isEligibleForAssignment (license,
//     active) — unless allow_conflicted=true on that row, in which case
//     conflict declarations are allowed but expired licenses still block
//   - duplicate (claim, surveyor, role) returns 400
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isEligibleForAssignment } from '@/lib/surveyors';
import { ASSIGNMENT_ROLES, findConflictedSurveyors } from '@/lib/assignmentRanking';
import { enqueueAssignmentNotify, enqueueIlaReminders } from '@/lib/notifications/queue';

export async function POST(request, { params }) {
  const { id } = params;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const body = await request.json();
  const items = Array.isArray(body.assignments) ? body.assignments : [];
  if (items.length === 0) {
    return NextResponse.json({ error: 'assignments[] is required' }, { status: 400 });
  }

  for (const item of items) {
    if (!item.surveyor_id) {
      return NextResponse.json({ error: 'each assignment needs surveyor_id' }, { status: 400 });
    }
    if (!ASSIGNMENT_ROLES.includes(item.role)) {
      return NextResponse.json(
        { error: `role must be one of: ${ASSIGNMENT_ROLES.join(', ')}` },
        { status: 400 }
      );
    }
  }

  const leadCount = items.filter(i => i.role === 'lead_surveyor').length;
  if (leadCount !== 1) {
    return NextResponse.json(
      { error: `exactly one lead_surveyor required (got ${leadCount})` },
      { status: 400 }
    );
  }

  const surveyorIds = items.map(i => i.surveyor_id);

  const today = new Date();
  const [{ data: claim }, { data: surveyors }, { data: conflicts }] = await Promise.all([
    supabaseAdmin.from('claims').select('*').eq('id', id).single(),
    supabaseAdmin.from('surveyors').select('*').in('id', surveyorIds),
    supabaseAdmin.from('surveyor_conflicts').select('*').in('surveyor_id', surveyorIds),
  ]);

  if (!claim) return NextResponse.json({ error: 'claim not found' }, { status: 404 });

  const surveyorById = new Map((surveyors || []).map(s => [s.id, s]));

  // Eligibility checks per item.
  for (const item of items) {
    const s = surveyorById.get(item.surveyor_id);
    if (!s) {
      return NextResponse.json({ error: `surveyor ${item.surveyor_id} not found` }, { status: 400 });
    }
    const elig = isEligibleForAssignment(s, today);
    if (!elig.eligible) {
      return NextResponse.json(
        { error: `${s.name || item.surveyor_id} is not eligible: ${elig.reason}` },
        { status: 400 }
      );
    }
  }

  // Conflict gate: if any conflicted surveyor is in the list and the
  // corresponding assignment doesn't carry allow_conflicted, block.
  const conflictedIds = new Set(
    findConflictedSurveyors({ claim, conflicts: conflicts || [] }).map(c => c.surveyor_id)
  );
  const blockingConflicts = items
    .filter(i => conflictedIds.has(i.surveyor_id) && i.allow_conflicted !== true);
  if (blockingConflicts.length > 0) {
    const names = blockingConflicts.map(i => surveyorById.get(i.surveyor_id)?.name || i.surveyor_id);
    return NextResponse.json(
      {
        error: `conflicts declared for: ${names.join(', ')}. Pass allow_conflicted=true per row to override.`,
        conflicted_surveyor_ids: Array.from(conflictedIds),
      },
      { status: 422 }
    );
  }

  const now = new Date().toISOString();
  const insertRows = items.map(i => {
    const s = surveyorById.get(i.surveyor_id);
    return {
      claim_id: parseInt(id, 10),
      surveyor_id: i.surveyor_id,
      assigned_to: s?.email || null,
      assigned_to_name: s?.name || null,
      assigned_by: body.assigned_by || null,
      role: i.role,
      assignment_type: i.role === 'lead_surveyor' ? 'lead' : 'team',
      priority: i.priority || 'Normal',
      notes: i.notes || null,
      assignment_basis: i.allow_conflicted ? 'override: conflict declared' : null,
      status: 'Assigned',
      assigned_date: now.slice(0, 10),
      company: body.company || claim.company || 'NISLA',
    };
  });

  const { data, error } = await supabaseAdmin
    .from('claim_assignments')
    .insert(insertRows)
    .select();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'one or more (claim, surveyor, role) pairs already exist' },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // High-level audit row
  await supabaseAdmin.from('activity_log').insert([{
    action: 'team_assigned',
    entity_type: 'claim',
    entity_id: String(id),
    claim_id: parseInt(id, 10),
    ref_number: claim.ref_number,
    user_email: body.assigned_by,
    company: claim.company,
    details: JSON.stringify({
      assignments: insertRows.map(r => ({ surveyor_id: r.surveyor_id, role: r.role })),
    }),
  }]);

  // Notifications (spec §11). Failures don't block the response — helpers
  // swallow + log; the queue cron retries pending rows.
  for (const item of items) {
    const s = surveyorById.get(item.surveyor_id);
    if (!s?.email) continue;
    await enqueueAssignmentNotify(supabaseAdmin, {
      claim,
      surveyor: s,
      role: item.role,
    });
  }

  // ILA-due reminders for the lead surveyor (24h, 6h, overdue).
  const leadItem = items.find(i => i.role === 'lead_surveyor');
  if (leadItem) {
    const lead = surveyorById.get(leadItem.surveyor_id);
    if (lead?.email && claim.ila_due_at) {
      await enqueueIlaReminders(supabaseAdmin, { claim, lead_surveyor: lead });
    }
  }

  return NextResponse.json({ assignments: data || [] }, { status: 201 });
}

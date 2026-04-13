import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// The 19 IRDAI lifecycle stages with TAT configuration
const LIFECYCLE_STAGES = [
  { stage_number: 1, stage_name: 'Intimation Received', tat_days: 0, tat_from: 'immediate' },
  { stage_number: 2, stage_name: 'Claim Registered & File Number Assigned', tat_days: 0, tat_from: 'immediate' },
  { stage_number: 3, stage_name: 'Acknowledgement Sent', tat_days: 0, tat_from: 'immediate' },
  { stage_number: 4, stage_name: 'Surveyor Assigned', tat_days: 0, tat_from: 'immediate' },
  { stage_number: 5, stage_name: 'Survey Completed', tat_days: 1, tat_from: 'date_of_intimation' },
  { stage_number: 6, stage_name: 'LOR Sent to Insured', tat_days: 2, tat_from: 'date_of_intimation' },
  { stage_number: 7, stage_name: 'ILA Issued to Insurer', tat_days: 3, tat_from: 'date_of_intimation' },
  { stage_number: 8, stage_name: 'Gentle Reminder (7 days after LOR)', tat_days: 7, tat_from: 'stage_6' },
  { stage_number: 9, stage_name: 'Gentle Reminder 1 (7 days after Reminder)', tat_days: 7, tat_from: 'stage_8' },
  { stage_number: 10, stage_name: 'Gentle Reminder 2 (7 days after Reminder 1)', tat_days: 7, tat_from: 'stage_9' },
  { stage_number: 11, stage_name: 'Final Reminder (7 days after Reminder 2)', tat_days: 7, tat_from: 'stage_10' },
  { stage_number: 12, stage_name: 'Closure Notice', tat_days: 7, tat_from: 'stage_11' },
  { stage_number: 13, stage_name: 'Documents Received & Updated', tat_days: null, tat_from: 'ongoing' },
  { stage_number: 14, stage_name: 'Salvaging Process', tat_days: null, tat_from: 'ongoing' },
  { stage_number: 15, stage_name: 'Report Preparation', tat_days: null, tat_from: 'ongoing' },
  { stage_number: 16, stage_name: 'Assessment Done', tat_days: null, tat_from: 'ongoing' },
  { stage_number: 17, stage_name: 'Assessment Shared', tat_days: null, tat_from: 'ongoing' },
  { stage_number: 18, stage_name: 'Consent Received', tat_days: null, tat_from: 'ongoing' },
  { stage_number: 19, stage_name: 'FSR Created', tat_days: 30, tat_from: 'date_of_intimation' },
  { stage_number: 20, stage_name: 'Survey Fee Bill Created', tat_days: null, tat_from: 'ongoing' },
  { stage_number: 21, stage_name: 'Report Dispatched', tat_days: null, tat_from: 'ongoing' },
  { stage_number: 22, stage_name: 'Payment Receipt Updated', tat_days: null, tat_from: 'ongoing' },
];

// GET - Get workflow for a specific claim or list all
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claimId = searchParams.get('claim_id');
  const company = searchParams.get('company');
  const breachedOnly = searchParams.get('breached_only');

  let query = supabase.from('claim_workflow').select('*').order('stage_number', { ascending: true });

  if (claimId) query = query.eq('claim_id', claimId);
  if (company && company !== 'All') query = query.eq('company', company);
  if (breachedOnly === 'true') query = query.eq('is_tat_breached', true).neq('status', 'Completed');

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST - Initialize workflow for a claim (creates all 22 stages)
export async function POST(request) {
  const body = await request.json();
  const { claim_id, ref_number, date_of_intimation, company, assigned_to, assigned_by, file_handler, survey_type, surveyor_name, pan_india_surveyor } = body;

  if (!claim_id) return NextResponse.json({ error: 'claim_id is required' }, { status: 400 });

  // Check if workflow already exists for this claim
  const { data: existing } = await supabase
    .from('claim_workflow')
    .select('id')
    .eq('claim_id', claim_id)
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({ error: 'Workflow already exists for this claim' }, { status: 400 });
  }

  const baseDate = date_of_intimation ? new Date(date_of_intimation) : new Date();

  // Create all stages
  const stages = LIFECYCLE_STAGES.map(stage => {
    let dueDate = null;
    if (stage.tat_days !== null && stage.tat_from !== 'ongoing') {
      if (stage.tat_from === 'immediate') {
        dueDate = baseDate.toISOString().split('T')[0];
      } else if (stage.tat_from === 'date_of_intimation') {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + stage.tat_days);
        dueDate = d.toISOString().split('T')[0];
      }
      // For stage_X references, due dates will be calculated when that stage is completed
    }

    // Build extra metadata for surveyor assignment stage
    let stageComments = null;
    if (stage.stage_number === 4 && survey_type) {
      const surveyInfo = [`Survey Type: ${survey_type}`];
      if (surveyor_name) surveyInfo.push(`Surveyor: ${surveyor_name}`);
      if (pan_india_surveyor) surveyInfo.push(`PAN India: ${pan_india_surveyor}`);
      stageComments = surveyInfo.join(' | ');
    }

    return {
      claim_id,
      ref_number: ref_number || null,
      stage_number: stage.stage_number,
      stage_name: stage.stage_name,
      status: stage.stage_number <= 2 ? 'Completed' : 'Pending',
      completed_date: stage.stage_number <= 2 ? new Date().toISOString() : null,
      due_date: dueDate,
      assigned_to: file_handler || assigned_to || null,
      assigned_by: assigned_by || null,
      comments: stageComments,
      tat_days: stage.tat_days,
      tat_from: stage.tat_from,
      company: company || 'NISLA',
    };
  });

  const { data, error } = await supabase.from('claim_workflow').insert(stages).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

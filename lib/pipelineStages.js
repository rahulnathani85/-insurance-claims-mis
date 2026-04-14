// 9-Stage Claim Pipeline for general claims (non-EW)
export const PIPELINE_STAGES = [
  { number: 1, name: 'Pending Assignment',               short: 'Pending',    color: '#94a3b8' },
  { number: 2, name: 'Assigned',                          short: 'Assigned',   color: '#3b82f6' },
  { number: 3, name: 'Inspection Scheduled',              short: 'Scheduled',  color: '#8b5cf6' },
  { number: 4, name: 'Inspection Done',                   short: 'Inspected',  color: '#6366f1' },
  { number: 5, name: 'Under Assessment',                  short: 'Assessment', color: '#f59e0b' },
  { number: 6, name: 'Query Raised / Awaiting Documents', short: 'Query',      color: '#ef4444' },
  { number: 7, name: 'Report in Progress',                short: 'Report WIP', color: '#0891b2' },
  { number: 8, name: 'Report Submitted',                  short: 'Submitted',  color: '#16a34a' },
  { number: 9, name: 'Closed / Repudiated',               short: 'Closed',     color: '#475569' },
];

export const PIPELINE_STAGE_COUNT = PIPELINE_STAGES.length;

export const PIPELINE_STAGE_NAMES = PIPELINE_STAGES.map(s => s.name);

// TAT configuration by LOB (values in hours)
export const TAT_CONFIG = {
  'Extended Warranty': [
    { milestone: 'Initial Inspection', hours: 4, from: 'intimation', stage_trigger: 4 },
  ],
  'Marine Cargo': [
    { milestone: 'Survey Visit', hours: 24, from: 'intimation', stage_trigger: 4 },
  ],
  'Fire': [
    { milestone: 'Interim Report', hours: 30 * 24, from: 'intimation', stage_trigger: 7 },
    { milestone: 'Final Report', hours: 90 * 24, from: 'intimation', stage_trigger: 8 },
  ],
  'Engineering': [
    { milestone: 'Interim Report', hours: 30 * 24, from: 'intimation', stage_trigger: 7 },
    { milestone: 'Final Report', hours: 90 * 24, from: 'intimation', stage_trigger: 8 },
  ],
  'Cat Event': [
    { milestone: 'Interim Report', hours: 30 * 24, from: 'intimation', stage_trigger: 7 },
    { milestone: 'Final Report', hours: 90 * 24, from: 'intimation', stage_trigger: 8 },
  ],
  'Business Interruption': [
    { milestone: 'Final Report', hours: 90 * 24, from: 'intimation', stage_trigger: 8 },
  ],
  'Miscellaneous': [
    { milestone: 'Final Report', hours: 90 * 24, from: 'intimation', stage_trigger: 8 },
  ],
};

// Get the most urgent TAT deadline for a claim
export function getClaimTatDeadline(lob, dateIntimation, currentStageNumber) {
  if (!dateIntimation || !lob) return null;
  const config = TAT_CONFIG[lob];
  if (!config) return null;

  const intimation = new Date(dateIntimation);
  const now = new Date();

  // Find the next upcoming TAT milestone that hasn't been passed yet
  for (const tat of config) {
    if (currentStageNumber < tat.stage_trigger) {
      const deadline = new Date(intimation.getTime() + tat.hours * 60 * 60 * 1000);
      return { deadline, milestone: tat.milestone, hours: tat.hours };
    }
  }
  return null;
}

// TAT badge: green / amber / red
export function getTatBadge(deadline) {
  if (!deadline) return null;
  const now = new Date();
  const due = new Date(deadline);
  const diffMs = due - now;
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffMs < 0) return { key: 'red', label: 'OVERDUE', bg: '#fef2f2', color: '#dc2626', border: '#fca5a5' };
  if (diffHours <= 72) return { key: 'amber', label: 'DUE SOON', bg: '#fffbeb', color: '#d97706', border: '#fcd34d' };
  return { key: 'green', label: 'ON TRACK', bg: '#f0fdf4', color: '#16a34a', border: '#86efac' };
}

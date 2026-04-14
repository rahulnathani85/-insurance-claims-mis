// New 8-stage EW workflow (replaces old 12-stage)
export const EW_STAGES = [
  { number: 1, name: 'Intimation & Registration', short: 'Intimation' },
  { number: 2, name: 'Initial Inspection Done', short: 'Inspection' },
  { number: 3, name: 'Observation Shared', short: 'Observation' },
  { number: 4, name: 'Dismantling Inspection', short: 'Dismantling' },
  { number: 5, name: 'Reinspection', short: 'Reinspect' },
  { number: 6, name: 'Tax Invoice Receipt', short: 'Invoice' },
  { number: 7, name: 'Assessment', short: 'Assessment' },
  { number: 8, name: 'Final Survey Report', short: 'FSR' },
];

export const STAGE_COUNT = EW_STAGES.length; // 8

// Mapping from old 12-stage numbers to new 8-stage numbers
export const OLD_TO_NEW_STAGE_MAP = {
  1: 1, 2: 1,   // Intimation + Registration -> 1
  3: 2, 4: 2,   // Contact Dealer + Initial Inspection -> 2
  5: 3, 6: 3,   // Document Analysis + Observation Shared -> 3
  7: 4,          // Dismantled Inspection -> 4
  8: 5, 9: 5,   // Estimate Approved + Reinspection -> 5
  10: 6,         // Tax Invoice -> 6
  11: 7,         // Assessment Done -> 7
  12: 8,         // FSR Prepared -> 8
};

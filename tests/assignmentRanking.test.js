// =============================================================================
// tests/assignmentRanking.test.js
// =============================================================================
// Unit tests for lib/assignmentRanking.js (Slice F).
// =============================================================================

import { describe, it, expect } from 'vitest';
import { rankSurveyors, findConflictedSurveyors, ASSIGNMENT_ROLES } from '../lib/assignmentRanking.js';

const TODAY = new Date('2026-04-30T00:00:00Z');
function plusDays(n) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const baseClaim = {
  lob: 'Fire',
  peril_type: 'Fire',
  insurer_name: 'New India Assurance',
  insured_name: 'Acme Industries',
  loss_location_state: 'West',
};

const eligibleSurveyor = (over = {}) => ({
  id: over.id || 's1',
  name: over.name || 'Jane Doe',
  active: true,
  license_number: 'IRDAI/CORP/SLA-200025',
  license_expiry_date: plusDays(365),
  peril_specialties: ['Fire'],
  region: 'West',
  ...over,
});

describe('ASSIGNMENT_ROLES', () => {
  it('matches the canonical role list', () => {
    expect(ASSIGNMENT_ROLES).toEqual([
      'lead_surveyor', 'co_surveyor', 'engineer', 'ca', 'manager', 'observer',
    ]);
  });
});

describe('rankSurveyors — eligibility gates', () => {
  it('blocks expired licenses', () => {
    const out = rankSurveyors({
      claim: baseClaim,
      surveyors: [eligibleSurveyor({ license_expiry_date: plusDays(-1) })],
      today: TODAY,
    });
    expect(out.eligible).toHaveLength(0);
    expect(out.blocked).toHaveLength(1);
    expect(out.blocked[0].reason).toMatch(/expired/i);
  });

  it('blocks inactive surveyors', () => {
    const out = rankSurveyors({
      claim: baseClaim,
      surveyors: [eligibleSurveyor({ active: false })],
      today: TODAY,
    });
    expect(out.eligible).toHaveLength(0);
    expect(out.blocked[0].reason).toMatch(/inactive/i);
  });

  it('blocks surveyors not licensed for the peril', () => {
    const out = rankSurveyors({
      claim: baseClaim,
      surveyors: [eligibleSurveyor({ peril_specialties: ['Marine Cargo'] })],
      today: TODAY,
    });
    expect(out.eligible).toHaveLength(0);
    expect(out.blocked[0].reason).toMatch(/not licensed for fire/i);
  });

  it('treats empty peril_specialties as generalist (not blocked)', () => {
    const out = rankSurveyors({
      claim: baseClaim,
      surveyors: [eligibleSurveyor({ peril_specialties: [] })],
      today: TODAY,
    });
    expect(out.eligible).toHaveLength(1);
    expect(out.eligible[0].reasons).toContain('Generalist (no peril restriction recorded)');
  });
});

describe('rankSurveyors — conflict gate', () => {
  it('blocks when an insurer-conflict matches the claim', () => {
    const out = rankSurveyors({
      claim: baseClaim,
      surveyors: [eligibleSurveyor()],
      conflicts: [{ surveyor_id: 's1', conflict_type: 'insurer', conflict_value: 'New India Assurance' }],
      today: TODAY,
    });
    expect(out.eligible).toHaveLength(0);
    expect(out.blocked[0].reason).toMatch(/conflict declared/i);
  });

  it('does case-insensitive substring match on conflict values', () => {
    const out = rankSurveyors({
      claim: { ...baseClaim, insurer_name: 'New India Assurance Co Ltd' },
      surveyors: [eligibleSurveyor()],
      conflicts: [{ surveyor_id: 's1', conflict_type: 'insurer', conflict_value: 'new india' }],
      today: TODAY,
    });
    expect(out.eligible).toHaveLength(0);
    expect(out.blocked).toHaveLength(1);
  });

  it('allows conflicted surveyors when allowConflicted=true', () => {
    const out = rankSurveyors({
      claim: baseClaim,
      surveyors: [eligibleSurveyor()],
      conflicts: [{ surveyor_id: 's1', conflict_type: 'insured', conflict_value: 'Acme Industries' }],
      today: TODAY,
      options: { allowConflicted: true },
    });
    expect(out.eligible).toHaveLength(1);
    expect(out.eligible[0].conflicts).toHaveLength(1);
  });

  it('non-matching conflict types do not block', () => {
    const out = rankSurveyors({
      claim: baseClaim,
      surveyors: [eligibleSurveyor()],
      conflicts: [{ surveyor_id: 's1', conflict_type: 'broker', conflict_value: 'OtherBroker' }],
      today: TODAY,
    });
    expect(out.eligible).toHaveLength(1);
  });
});

describe('rankSurveyors — ranking order', () => {
  it('ranks region-matching surveyors above non-matching', () => {
    const out = rankSurveyors({
      claim: baseClaim,
      surveyors: [
        eligibleSurveyor({ id: 'east', name: 'East', region: 'East' }),
        eligibleSurveyor({ id: 'west', name: 'West', region: 'West' }),
      ],
      today: TODAY,
    });
    expect(out.eligible[0].surveyor.id).toBe('west');
  });

  it('penalises higher workload', () => {
    const out = rankSurveyors({
      claim: baseClaim,
      surveyors: [
        eligibleSurveyor({ id: 'busy', name: 'Busy' }),
        eligibleSurveyor({ id: 'free', name: 'Free' }),
      ],
      workloads: { busy: 100, free: 0 },
      today: TODAY,
    });
    expect(out.eligible[0].surveyor.id).toBe('free');
  });

  it('peril-licensed beats generalist on score', () => {
    const out = rankSurveyors({
      claim: baseClaim,
      surveyors: [
        eligibleSurveyor({ id: 'general', name: 'General', peril_specialties: [] }),
        eligibleSurveyor({ id: 'fire', name: 'Fire' }),
      ],
      today: TODAY,
    });
    expect(out.eligible[0].surveyor.id).toBe('fire');
  });

  it('reasons explain why', () => {
    const out = rankSurveyors({
      claim: baseClaim,
      surveyors: [eligibleSurveyor()],
      workloads: { s1: 3 },
      today: TODAY,
    });
    expect(out.eligible[0].reasons).toEqual(
      expect.arrayContaining([
        'Licensed for Fire',
        'Region match: West',
        '3 active claims',
      ])
    );
  });
});

describe('findConflictedSurveyors', () => {
  it('returns surveyors whose declared conflict matches the claim', () => {
    const out = findConflictedSurveyors({
      claim: baseClaim,
      conflicts: [
        { surveyor_id: 's1', conflict_type: 'insurer', conflict_value: 'New India Assurance' },
        { surveyor_id: 's2', conflict_type: 'insurer', conflict_value: 'Other Insurer' },
        { surveyor_id: 's3', conflict_type: 'insured', conflict_value: 'Acme' },
      ],
    });
    const ids = out.map(o => o.surveyor_id).sort();
    expect(ids).toEqual(['s1', 's3']);
  });

  it('returns empty when no claim names match', () => {
    const out = findConflictedSurveyors({
      claim: { ...baseClaim, insurer_name: 'Nobody', insured_name: 'NoOne' },
      conflicts: [{ surveyor_id: 's1', conflict_type: 'insurer', conflict_value: 'Other Insurer' }],
    });
    expect(out).toEqual([]);
  });

  it('handles missing claim or conflicts safely', () => {
    expect(findConflictedSurveyors({ claim: {}, conflicts: [] })).toEqual([]);
    expect(findConflictedSurveyors({ claim: baseClaim, conflicts: null })).toEqual([]);
  });
});

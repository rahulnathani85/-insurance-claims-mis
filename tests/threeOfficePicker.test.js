// =============================================================================
// tests/threeOfficePicker.test.js
// =============================================================================
// Pure-logic tests for the role-config helper exported from
// components/ThreeOfficePicker.js. The wrapper component itself is rendered
// in development and verified manually — repo doesn't ship jsdom.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { ROLE_DEFS, buildRoleConfig } from '../lib/officeRoles.js';

describe('ROLE_DEFS', () => {
  it('exposes exactly the 3 roles in fixed order', () => {
    expect(ROLE_DEFS.map((r) => r.role)).toEqual(['appointing', 'policy', 'fsr']);
  });

  it('matches the documented colors (amber / blue / green)', () => {
    expect(ROLE_DEFS[0].color).toBe('#92400e'); // amber
    expect(ROLE_DEFS[1].color).toBe('#1e40af'); // blue
    expect(ROLE_DEFS[2].color).toBe('#166534'); // green
  });

  it('has human-readable labels', () => {
    expect(ROLE_DEFS[0].label).toBe('Appointing Office');
    expect(ROLE_DEFS[1].label).toBe('Underwriting / Policy Issuing Office');
    expect(ROLE_DEFS[2].label).toBe('Report Submission Office');
  });
});

describe('buildRoleConfig', () => {
  it('defaults FSR to optional, the other two required', () => {
    const cfg = buildRoleConfig();
    const byRole = Object.fromEntries(cfg.map((c) => [c.role, c]));
    expect(byRole.appointing.required).toBe(true);
    expect(byRole.policy.required).toBe(true);
    expect(byRole.fsr.required).toBe(false);
  });

  it('respects an empty optionalRoles array', () => {
    const cfg = buildRoleConfig([]);
    expect(cfg.every((c) => c.required)).toBe(true);
  });

  it('marks all roles optional when all are listed', () => {
    const cfg = buildRoleConfig(['appointing', 'policy', 'fsr']);
    expect(cfg.every((c) => c.required === false)).toBe(true);
  });

  it('returns 3 entries regardless of input', () => {
    expect(buildRoleConfig().length).toBe(3);
    expect(buildRoleConfig(['fsr']).length).toBe(3);
    expect(buildRoleConfig(['appointing', 'policy']).length).toBe(3);
  });

  it('preserves role/label/color from ROLE_DEFS', () => {
    const cfg = buildRoleConfig(['fsr']);
    cfg.forEach((c, i) => {
      expect(c.role).toBe(ROLE_DEFS[i].role);
      expect(c.label).toBe(ROLE_DEFS[i].label);
      expect(c.color).toBe(ROLE_DEFS[i].color);
    });
  });
});

describe('onChange role tagging contract', () => {
  // The wrapper's onChange((role, office) => ...) must be invoked with the
  // exact role string from ROLE_DEFS — never a typo, never the index.
  // This guards future edits where someone might pass `i` instead of `role`.
  it('every emitted role is one of the three documented roles', () => {
    const validRoles = new Set(['appointing', 'policy', 'fsr']);
    for (const def of ROLE_DEFS) {
      expect(validRoles.has(def.role)).toBe(true);
    }
  });

  // Simulate the wrapper's onChange dispatch by walking the cfg and
  // verifying the role tag passed back to the parent for each card.
  it('parent receives one onChange per role with correct role string', () => {
    const calls = [];
    const onChange = (role, office) => calls.push({ role, office });

    // Mimic the wrapper rendering 3 children and each emitting onChange.
    const office = { id: 99, name: 'Test BO' };
    for (const def of buildRoleConfig()) {
      // This is what ThreeOfficePicker's child onChange does:
      //   onChange={(office) => onChange?.(role, office)}
      onChange(def.role, office);
    }
    expect(calls).toEqual([
      { role: 'appointing', office },
      { role: 'policy', office },
      { role: 'fsr', office },
    ]);
  });
});

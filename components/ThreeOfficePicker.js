'use client';
// =============================================================================
// components/ThreeOfficePicker.js
// =============================================================================
// Stacked wrapper around three OfficeSearchPicker instances — one per
// insurer-office role on a claim:
//   - Appointing Office          (amber)
//   - Underwriting / Policy Issuing Office (blue)
//   - Report Submission Office   (green)
//
// Per CLAUDE.md §17, this is the canonical input on every claim form
// (Fire, Marine, Engineering, EW-Vehicle, EW-Others, BI, Liability, CAT —
// current and future). Don't roll your own.
//
// Props:
//   insurerId       number | null
//   values          { appointing: id|null, policy: id|null, fsr: id|null }
//   onChange        (role, office | null) => void
//   optionalRoles   string[]?   default ['fsr']  (FSR set later in lifecycle)
// =============================================================================

import OfficeSearchPicker from './OfficeSearchPicker';
import { ROLE_DEFS, buildRoleConfig } from '@/lib/officeRoles';

// Re-export for callers that prefer importing from the component path.
// The pure source of truth lives in lib/officeRoles.js so vitest can
// import it without pulling JSX through its loader.
export { ROLE_DEFS, buildRoleConfig };

export default function ThreeOfficePicker({
  insurerId,
  values = {},
  onChange,
  optionalRoles = ['fsr'],
}) {
  const cfg = buildRoleConfig(optionalRoles);
  const disabled = insurerId == null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {cfg.map(({ role, label, color, required }) => (
        <div
          key={role}
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: 12,
            background: '#fafafa',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
              color,
              marginBottom: 8,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: color,
                display: 'inline-block',
              }}
            />
            <span>
              {label}
              {required && <span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>}
            </span>
            {disabled && (
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 10,
                  fontWeight: 500,
                  color: '#94a3b8',
                  textTransform: 'none',
                  letterSpacing: 0,
                }}
              >
                Pick an insurer first
              </span>
            )}
          </div>
          <OfficeSearchPicker
            insurerId={insurerId}
            value={values?.[role] ?? null}
            role={role}
            required={required}
            onChange={(office) => onChange?.(role, office)}
          />
        </div>
      ))}
    </div>
  );
}

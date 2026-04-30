// =============================================================================
// tests/notificationTemplates.test.js
// =============================================================================
// Tests for lib/notifications/templates.js (Slice G).
// Pin the rendered text fragments + subject lines so a careless template edit
// surfaces in tests.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  registrationAck,
  assignmentNotify,
  ilaReminder,
  renderTemplate,
  NOTIFICATION_TYPES,
} from '../lib/notifications/templates.js';

describe('NOTIFICATION_TYPES', () => {
  it('includes all spec §11 channels', () => {
    expect(NOTIFICATION_TYPES).toEqual([
      'registration_ack',
      'assignment_notify',
      'ila_reminder_24h',
      'ila_reminder_6h',
      'ila_overdue',
    ]);
  });
});

describe('registrationAck', () => {
  const baseVars = {
    recipient_name: 'Mr Sharma',
    claim_ref: '4053/26-27/Fire',
    insured_name: 'Acme Industries',
    insurer_name: 'New India Assurance',
    complexity_tier: 'standard',
    ila_due_at: '2026-04-30T15:00:00Z',
    fsr_due_at: '2026-05-30T15:00:00Z',
    company: 'NISLA',
  };

  it('renders subject with claim ref + insured', () => {
    const out = registrationAck(baseVars);
    expect(out.subject).toBe('[NISLA] Claim 4053/26-27/Fire acknowledged — Acme Industries');
  });

  it('mentions IRDAI 72-hour rule', () => {
    const out = registrationAck(baseVars);
    expect(out.body_text).toMatch(/72 hours/);
  });

  it('falls back when lead surveyor not yet assigned', () => {
    const out = registrationAck(baseVars);
    expect(out.body_text).toMatch(/will be assigned shortly/);
  });

  it('includes lead surveyor when present', () => {
    const out = registrationAck({
      ...baseVars,
      lead_name: 'Jane Doe',
      lead_email: 'jane@nisla.in',
      lead_phone: '+91 99999 99999',
    });
    expect(out.body_text).toMatch(/Jane Doe/);
    expect(out.body_text).toMatch(/jane@nisla.in/);
  });

  it('throws on missing required vars', () => {
    expect(() => registrationAck({})).toThrow(/claim_ref/);
    expect(() => registrationAck({ claim_ref: 'X' })).toThrow(/insured_name/);
  });

  it('escapes HTML in HTML body', () => {
    const out = registrationAck({ ...baseVars, insured_name: '<script>alert(1)</script>' });
    expect(out.body_html).not.toMatch(/<script>/);
    expect(out.body_html).toMatch(/&lt;script&gt;/);
  });
});

describe('assignmentNotify', () => {
  const baseVars = {
    recipient_name: 'Jane Doe',
    role: 'lead_surveyor',
    claim_ref: '4053/26-27/Fire',
    insured_name: 'Acme Industries',
    insurer_name: 'New India Assurance',
    peril: 'Fire',
    date_loss: '2026-04-29',
    sum_insured: 5000000,
    loss_location: 'Mumbai',
    ila_due_at: '2026-04-30T15:00:00Z',
    company: 'NISLA',
  };

  it('subject includes claim ref + role label', () => {
    const out = assignmentNotify(baseVars);
    expect(out.subject).toBe('[NISLA] Assigned: 4053/26-27/Fire — Lead Surveyor');
  });

  it('formats sum insured in INR', () => {
    const out = assignmentNotify(baseVars);
    expect(out.body_text).toMatch(/₹50,00,000|₹5,000,000/); // INR formatting
  });

  it('asks lead surveyor to file ILA in 72h', () => {
    const out = assignmentNotify(baseVars);
    expect(out.body_text).toMatch(/Initial Loss Advice/);
    expect(out.body_text).toMatch(/72 hours/);
  });

  it('asks non-lead roles to coordinate with lead', () => {
    const out = assignmentNotify({ ...baseVars, role: 'engineer' });
    expect(out.subject).toMatch(/Engineer/);
    expect(out.body_text).toMatch(/coordinate with the Lead Surveyor/);
  });

  it('renders unknown role label as the raw role string', () => {
    const out = assignmentNotify({ ...baseVars, role: 'wildcard' });
    expect(out.subject).toMatch(/wildcard/);
  });
});

describe('ilaReminder', () => {
  const base = {
    recipient_name: 'Jane Doe',
    claim_ref: '4053/26-27/Fire',
    insured_name: 'Acme Industries',
    ila_due_at: '2026-04-30T15:00:00Z',
  };

  it('subject prefix differs by severity', () => {
    expect(ilaReminder({ ...base, severity: 'warn' }).subject).toMatch(/^\[Reminder\]/);
    expect(ilaReminder({ ...base, severity: 'urgent' }).subject).toMatch(/^\[URGENT\]/);
    expect(ilaReminder({ ...base, severity: 'overdue' }).subject).toMatch(/^\[OVERDUE\]/);
  });

  it('overdue body uses past-tense language', () => {
    const out = ilaReminder({ ...base, severity: 'overdue' });
    expect(out.body_text).toMatch(/72-hour ILA window has elapsed/);
  });

  it('includes hours remaining when provided', () => {
    const out = ilaReminder({ ...base, severity: 'warn', hours_remaining: 24 });
    expect(out.body_text).toMatch(/24h remaining/);
  });

  it('throws without claim_ref / ila_due_at / severity', () => {
    expect(() => ilaReminder({ severity: 'warn' })).toThrow();
    expect(() => ilaReminder({ ...base })).toThrow(/severity/);
  });
});

describe('renderTemplate', () => {
  it('routes to the right template by type', () => {
    const out = renderTemplate('registration_ack', {
      claim_ref: 'X', insured_name: 'Y',
    });
    expect(out.subject).toMatch(/Claim X/);
  });

  it('throws on unknown type', () => {
    expect(() => renderTemplate('made_up', {})).toThrow(/Unknown notification type/);
  });

  it('ila_reminder_6h uses urgent severity', () => {
    const out = renderTemplate('ila_reminder_6h', {
      claim_ref: 'X', ila_due_at: '2026-04-30T15:00:00Z',
    });
    expect(out.subject).toMatch(/^\[URGENT\]/);
  });
});

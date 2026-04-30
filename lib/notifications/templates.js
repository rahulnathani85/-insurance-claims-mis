// =============================================================================
// lib/notifications/templates.js
// =============================================================================
// Email templates for the notification queue (registration spec §11).
//
// Each template is a pure function:
//   (vars) => { subject, body_text, body_html }
//
// Vars are passed as a single object and validated with required-key gates
// rather than schema libs, matching the JS-only convention in the rest of the
// codebase. Tests pin the rendered output for stable subjects + body
// fragments.
// =============================================================================

import { fmtDateTimeIST, fmtINR } from './format.js';

export const NOTIFICATION_TYPES = [
  'registration_ack',     // → insurer dealing officer: claim registered
  'assignment_notify',    // → assigned surveyor: new assignment
  'ila_reminder_24h',     // → lead surveyor: ILA due in 24h
  'ila_reminder_6h',      // → lead surveyor: ILA due in 6h
  'ila_overdue',          // → lead surveyor + manager: ILA missed
  'ila_submitted',        // → insurer dealing officer: ILA filed (PDF attached)
];

// -----------------------------------------------------------------------------
// registrationAck
// To: insurer dealing officer.
// Vars: { recipient_name, claim_ref, insured_name, insurer_name, lead_name?,
//         lead_email?, lead_phone?, complexity_tier?, ila_due_at?, fsr_due_at?,
//         company? }
// -----------------------------------------------------------------------------
export function registrationAck(vars) {
  required(vars, ['claim_ref', 'insured_name']);
  const company = vars.company || 'NISLA';

  const subject = `[${company}] Claim ${vars.claim_ref} acknowledged — ${vars.insured_name}`;

  const text = trim(`
    Dear ${vars.recipient_name || 'Sir/Madam'},

    We acknowledge appointment for the survey of the below claim:

      Reference   : ${vars.claim_ref}
      Insured     : ${vars.insured_name}
      Insurer     : ${vars.insurer_name || 'N/A'}
      Tier        : ${vars.complexity_tier || 'to be classified'}
      ILA due     : ${fmtDateTimeIST(vars.ila_due_at)}
      FSR due     : ${fmtDateTimeIST(vars.fsr_due_at)}

    ${vars.lead_name
      ? `Lead surveyor: ${vars.lead_name}${vars.lead_email ? ` <${vars.lead_email}>` : ''}${vars.lead_phone ? ` · ${vars.lead_phone}` : ''}`
      : 'Lead surveyor will be assigned shortly and confirmed in the next email.'}

    The Initial Loss Advice (ILA) will be issued within 72 hours of assignment as required by IRDAI.

    Please reply to this email with any policy / supporting documents.

    Regards,
    ${company} Claims Desk
  `);

  const html = `
    <p>Dear ${esc(vars.recipient_name) || 'Sir/Madam'},</p>
    <p>We acknowledge appointment for the survey of the below claim:</p>
    <table style="border-collapse:collapse;font-size:14px">
      <tr><td><b>Reference</b></td><td>${esc(vars.claim_ref)}</td></tr>
      <tr><td><b>Insured</b></td><td>${esc(vars.insured_name)}</td></tr>
      <tr><td><b>Insurer</b></td><td>${esc(vars.insurer_name) || 'N/A'}</td></tr>
      <tr><td><b>Tier</b></td><td>${esc(vars.complexity_tier) || 'to be classified'}</td></tr>
      <tr><td><b>ILA due</b></td><td>${esc(fmtDateTimeIST(vars.ila_due_at))}</td></tr>
      <tr><td><b>FSR due</b></td><td>${esc(fmtDateTimeIST(vars.fsr_due_at))}</td></tr>
    </table>
    ${vars.lead_name
      ? `<p>Lead surveyor: <b>${esc(vars.lead_name)}</b>${vars.lead_email ? ` &lt;${esc(vars.lead_email)}&gt;` : ''}${vars.lead_phone ? ` · ${esc(vars.lead_phone)}` : ''}</p>`
      : `<p><i>Lead surveyor will be assigned shortly and confirmed in the next email.</i></p>`}
    <p>The Initial Loss Advice (ILA) will be issued within 72 hours of assignment as required by IRDAI.</p>
    <p>Please reply to this email with any policy / supporting documents.</p>
    <p>Regards,<br>${esc(company)} Claims Desk</p>
  `;

  return { subject, body_text: text, body_html: html };
}

// -----------------------------------------------------------------------------
// assignmentNotify
// To: surveyor (lead or co/eng/CA/manager).
// Vars: { recipient_name, role, claim_ref, insured_name, insurer_name,
//         loss_location?, date_loss?, ila_due_at?, sum_insured?, peril?,
//         company? }
// -----------------------------------------------------------------------------
export function assignmentNotify(vars) {
  required(vars, ['claim_ref', 'role']);
  const company = vars.company || 'NISLA';

  const roleLabel = ({
    lead_surveyor: 'Lead Surveyor',
    co_surveyor: 'Co-Surveyor',
    engineer: 'Engineer',
    ca: 'CA',
    manager: 'Manager Observer',
    observer: 'Observer',
  })[vars.role] || vars.role;

  const subject = `[${company}] Assigned: ${vars.claim_ref} — ${roleLabel}`;

  const text = trim(`
    Dear ${vars.recipient_name || 'Surveyor'},

    You have been assigned to the following claim as ${roleLabel}:

      Reference     : ${vars.claim_ref}
      Insured       : ${vars.insured_name || 'N/A'}
      Insurer       : ${vars.insurer_name || 'N/A'}
      Peril         : ${vars.peril || 'N/A'}
      Date of loss  : ${vars.date_loss || 'N/A'}
      Sum insured   : ${vars.sum_insured ? fmtINR(vars.sum_insured) : 'N/A'}
      Loss location : ${vars.loss_location || 'N/A'}
      ILA due       : ${fmtDateTimeIST(vars.ila_due_at)}

    ${vars.role === 'lead_surveyor'
      ? 'Please ensure the Initial Loss Advice (ILA) is filed within 72 hours of this assignment.'
      : 'Please coordinate with the Lead Surveyor on this claim.'}

    Open in portal: ${vars.portal_url || ''}

    Regards,
    ${company} Operations
  `);

  return { subject, body_text: text, body_html: textToHtml(text) };
}

// -----------------------------------------------------------------------------
// ilaReminder
// To: lead surveyor (and CC manager when overdue).
// Vars: { recipient_name, claim_ref, insured_name, ila_due_at, hours_remaining,
//         severity ('warn' | 'urgent' | 'overdue'), company? }
// -----------------------------------------------------------------------------
export function ilaReminder(vars) {
  required(vars, ['claim_ref', 'ila_due_at', 'severity']);
  const company = vars.company || 'NISLA';
  const cleanRef = vars.claim_ref;

  let subjectPrefix;
  if (vars.severity === 'overdue') subjectPrefix = '[OVERDUE]';
  else if (vars.severity === 'urgent') subjectPrefix = '[URGENT]';
  else subjectPrefix = '[Reminder]';

  const subject = `${subjectPrefix} ILA due — ${cleanRef}`;

  const body = vars.severity === 'overdue'
    ? `The 72-hour ILA window has elapsed and the ILA has not been filed for ${cleanRef}. Please file immediately and reply to this email with the reason for delay.`
    : `The ILA for ${cleanRef} (${vars.insured_name || 'insured TBD'}) is due ${fmtDateTimeIST(vars.ila_due_at)}${typeof vars.hours_remaining === 'number' ? ` (${vars.hours_remaining}h remaining)` : ''}. Please file before the deadline to remain within IRDAI 72-hour window.`;

  const text = trim(`
    Dear ${vars.recipient_name || 'Surveyor'},

    ${body}

    Regards,
    ${company} Operations
  `);

  return { subject, body_text: text, body_html: textToHtml(text) };
}

// -----------------------------------------------------------------------------
// ilaSubmitted — to insurer dealing officer when ILA is filed.
// Vars: { recipient_name?, claim_ref, insured_name, signer_name, signer_license,
//         submitted_at, pdf_storage_path?, tat_compliant, company? }
// -----------------------------------------------------------------------------
export function ilaSubmitted(vars) {
  required(vars, ['claim_ref', 'insured_name', 'signer_name', 'signer_license']);
  const company = vars.company || 'NISLA';
  const tatLabel = vars.tat_compliant === false ? ' (filed past 72-hour window)' : '';

  const subject = `[${company}] ILA filed — ${vars.claim_ref} · ${vars.insured_name}${tatLabel}`;

  const text = trim(`
    Dear ${vars.recipient_name || 'Sir/Madam'},

    Please find attached the Initial Loss Advice (ILA) for the captioned claim.

      Reference   : ${vars.claim_ref}
      Insured     : ${vars.insured_name}
      Filed at    : ${fmtDateTimeIST(vars.submitted_at)}
      Signed by   : ${vars.signer_name} (IRDAI ${vars.signer_license})
      ${vars.tat_compliant === false ? 'Note        : Filed past the 72-hour IRDAI window — see PDF for explanation.' : 'Status      : Within IRDAI 72-hour window.'}

    The ILA contains our preliminary view, admissibility opinion, document checklist, and indicative timeline for FSR submission. Please reply to this email with any of the listed documents available at your end.

    The FSR will follow per the timeline indicated in the ILA.

    Regards,
    ${company} Claims Desk
  `);

  return { subject, body_text: text, body_html: textToHtml(text) };
}

export const TEMPLATES = {
  registration_ack: registrationAck,
  assignment_notify: assignmentNotify,
  ila_reminder_24h: (vars) => ilaReminder({ ...vars, severity: vars.severity || 'warn' }),
  ila_reminder_6h:  (vars) => ilaReminder({ ...vars, severity: vars.severity || 'urgent' }),
  ila_overdue:      (vars) => ilaReminder({ ...vars, severity: 'overdue' }),
  ila_submitted:    ilaSubmitted,
};

export function renderTemplate(notificationType, vars) {
  const fn = TEMPLATES[notificationType];
  if (!fn) throw new Error(`Unknown notification type: ${notificationType}`);
  return fn(vars);
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function required(vars, keys) {
  for (const k of keys) {
    if (vars?.[k] === undefined || vars?.[k] === null || vars?.[k] === '') {
      throw new Error(`template requires var: ${k}`);
    }
  }
}

function trim(s) {
  return s.split('\n').map(line => line.replace(/^    /, '')).join('\n').trim() + '\n';
}

function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function textToHtml(text) {
  return '<pre style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap">' + esc(text) + '</pre>';
}

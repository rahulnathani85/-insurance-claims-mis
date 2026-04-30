// =============================================================================
// lib/ila/templates.js
// =============================================================================
// HTML template for rendering an Initial Loss Advice (ILA) PDF.
// Sent to the puppeteer-server (scripts/puppeteer-server) which converts to
// PDF via Chromium.
//
// Phase 1: a single NISLA letterhead template, peril-agnostic. Per-insurer
// templates are Phase 2 (`insurer_ila_template_id`).
//
// Output is a self-contained HTML document — inline CSS, no external assets.
// =============================================================================

import { sortChecklist } from './checklist.js';

export function renderIlaHtml({ claim, draft, signer, company = 'NISLA' }) {
  const sub = sortChecklist(draft.documents_required || []);
  const cover = draft.cover_data || {};
  const fmtINR = (n) => {
    if (n === null || n === undefined || n === '') return '—';
    const num = Number(n);
    if (!Number.isFinite(num)) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(num);
  };
  const fmtDate = (v) => {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const admissibilityLabel = ({
    admissible: 'Admissible (prima facie covered)',
    admissible_with_conditions: 'Admissible with conditions',
    needs_investigation: 'Needs investigation',
    likely_non_admissible: 'Likely non-admissible',
    non_admissible: 'Non-admissible',
  })[draft.admissibility_opinion] || '—';

  const orgFullName = company === 'Acuere'
    ? 'Acuere Surveyors'
    : 'Nathani Insurance Surveyors and Loss Assessors Pvt. Ltd.';
  const orgLicense = company === 'Acuere'
    ? 'IRDAI/IND/SLA-85225'
    : 'IRDAI/CORP/SLA-200025';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>ILA — ${escapeHtml(claim.ref_number || claim.id)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #111; line-height: 1.45; }
  .letterhead { border-bottom: 2px solid #1e3a5f; padding-bottom: 10px; margin-bottom: 14px; }
  .letterhead h1 { margin: 0; font-size: 16pt; color: #1e3a5f; }
  .letterhead .sub { font-size: 9pt; color: #475569; margin-top: 2px; }
  .doc-title { text-align: center; font-size: 14pt; font-weight: 700; margin: 18px 0 4px; color: #1e3a5f; letter-spacing: 0.5px; }
  .doc-sub { text-align: center; font-size: 10pt; color: #475569; margin-bottom: 16px; }
  table.kv { width: 100%; border-collapse: collapse; margin: 8px 0 14px; }
  table.kv td { padding: 4px 8px; vertical-align: top; }
  table.kv td.k { width: 30%; font-weight: 600; color: #475569; }
  h2 { font-size: 12pt; color: #1e3a5f; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; margin: 18px 0 8px; }
  p { margin: 6px 0; }
  ul.checklist { padding-left: 18px; }
  ul.checklist li { margin-bottom: 4px; }
  .pill { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9pt; font-weight: 600; }
  .pill-high { background: #fee2e2; color: #b91c1c; }
  .pill-medium { background: #fef3c7; color: #b45309; }
  .pill-low { background: #e0f2fe; color: #0c4a6e; }
  .signoff { margin-top: 30px; padding-top: 14px; border-top: 1px dashed #94a3b8; }
  .signoff .sigblock { margin-top: 22px; font-size: 10pt; }
  .signoff .sig-name { font-weight: 700; }
  .footer { margin-top: 30px; font-size: 8pt; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  .reg-tag { background: #f1f5f9; padding: 6px 10px; border-radius: 4px; display: inline-block; font-size: 9pt; }
</style>
</head>
<body>

<div class="letterhead">
  <h1>${escapeHtml(orgFullName)}</h1>
  <div class="sub">IRDAI Licence: ${escapeHtml(orgLicense)} · Surveyors &amp; Loss Assessors</div>
</div>

<div class="doc-title">INITIAL LOSS ADVICE (ILA)</div>
<div class="doc-sub">Submitted under IRDAI Surveyors and Loss Assessors Regulations, 2015 — 72-hour requirement</div>

<table class="kv">
  <tr><td class="k">Surveyor reference</td><td><span class="reg-tag">${escapeHtml(claim.ref_number || `#${claim.id}`)}</span></td></tr>
  <tr><td class="k">Insurer</td><td>${escapeHtml(claim.insurer_name || cover.insurer_name || '—')}</td></tr>
  <tr><td class="k">Insurer claim number</td><td>${escapeHtml(claim.claim_number || '—')}</td></tr>
  <tr><td class="k">Insured</td><td>${escapeHtml(claim.insured_name || '—')}</td></tr>
  <tr><td class="k">Policy number</td><td>${escapeHtml(claim.policy_number || '—')}</td></tr>
  <tr><td class="k">LOB / sub-category</td><td>${escapeHtml(claim.lob || '—')}${claim.lob_subcategory ? ' — ' + escapeHtml(claim.lob_subcategory) : ''}</td></tr>
  <tr><td class="k">Date of loss</td><td>${escapeHtml(fmtDate(claim.date_loss))}</td></tr>
  <tr><td class="k">Date of intimation</td><td>${escapeHtml(fmtDate(claim.date_of_intimation))}</td></tr>
  <tr><td class="k">Date of assignment</td><td>${escapeHtml(fmtDate(claim.registered_at))}</td></tr>
  <tr><td class="k">Loss location</td><td>${escapeHtml(claim.loss_location || '—')}</td></tr>
</table>

<h2>1. Preliminary view of the loss</h2>
<p>${escapeHtml(draft.preliminary_view || '—').replace(/\n/g, '<br>')}</p>

<h2>2. Admissibility opinion</h2>
<p><strong>Opinion:</strong> ${escapeHtml(admissibilityLabel)}</p>
${draft.admissibility_reasoning ? `<p><strong>Reasoning:</strong> ${escapeHtml(draft.admissibility_reasoning).replace(/\n/g, '<br>')}</p>` : ''}
<p style="font-size: 9pt; color: #64748b;"><em>Note: This is a preliminary opinion based on the information available at the time of intimation. Final view depends on completion of investigation and submission of the Final Survey Report (FSR).</em></p>

<h2>3. Preliminary loss estimate</h2>
<p><strong>Estimate:</strong> ${escapeHtml(fmtINR(draft.preliminary_estimate))}</p>
${draft.estimate_basis ? `<p><strong>Basis:</strong> ${escapeHtml(draft.estimate_basis).replace(/\n/g, '<br>')}</p>` : ''}

<h2>4. Documents required</h2>
${sub.length === 0 ? '<p>None at this stage.</p>' : `
<ul class="checklist">
  ${sub.map((d) => `<li>
    <strong>${escapeHtml(d.type)}</strong>
    <span class="pill pill-${escapeHtml(d.priority || 'medium')}">${escapeHtml((d.priority || 'medium').toUpperCase())}</span>
    ${d.reason ? `<br><span style="font-size: 9pt; color: #475569;">${escapeHtml(d.reason)}</span>` : ''}
  </li>`).join('')}
</ul>
`}

<h2>5. Next steps</h2>
<p>${escapeHtml(draft.next_steps || '—').replace(/\n/g, '<br>')}</p>

${draft.expected_fsr_date ? `<p><strong>Expected FSR submission:</strong> ${escapeHtml(fmtDate(draft.expected_fsr_date))}</p>` : ''}

${draft.observations ? `
<h2>6. Other observations</h2>
<p>${escapeHtml(draft.observations).replace(/\n/g, '<br>')}</p>` : ''}

<div class="signoff">
  <p><strong>Signed by:</strong></p>
  <div class="sigblock">
    <div class="sig-name">${escapeHtml(signer?.name || signer?.email || '—')}</div>
    <div>IRDAI Licence: ${escapeHtml(signer?.license_number || '—')}${signer?.license_category ? ' (Category ' + escapeHtml(signer.license_category) + ')' : ''}</div>
    <div>For ${escapeHtml(orgFullName)}</div>
    <div style="margin-top: 6px; font-size: 9pt; color: #64748b;">Generated ${escapeHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))} IST</div>
  </div>
</div>

<div class="footer">
  This Initial Loss Advice is preliminary and subject to revision in the Final Survey Report.
  Generated by NISLA Portal · Surveyor reference ${escapeHtml(claim.ref_number || `#${claim.id}`)}
</div>

</body>
</html>`;
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// =============================================================================
// lib/fsr/render.js
// =============================================================================
// Renders an FSR HTML template (loaded from fsr_lob_templates.body_html)
// against a context built from the claim, latest ILA, and loss sheet.
//
// Substitution language is intentionally minimal — `{{path.with.dots}}`
// resolves against the context object. Missing values become "(blank)" so
// the rendered PDF never has unrendered tokens.
//
// A few specials are pre-rendered before substitution:
//   {{loss_items_table}}                  HTML <table> of line items
//   {{loss_sheet.underinsurance_paragraph}} prose summary of SI/VAR
//   {{loss_sheet.<field>_inr}}            INR-formatted variant of a field
//
// All HTML output from substitutions is escaped EXCEPT the loss_items_table,
// which is built by us and trusted.
// =============================================================================

const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
});

const ADMISSIBILITY_LABELS = {
  admissible: 'Admissible (prima facie covered)',
  admissible_with_conditions: 'Admissible with conditions',
  needs_investigation: 'Needs investigation',
  likely_non_admissible: 'Likely non-admissible',
  non_admissible: 'Non-admissible',
};

// -----------------------------------------------------------------------------
// renderFsrHtml — top-level entry
// -----------------------------------------------------------------------------
export function renderFsrHtml({ template, claim, lossSheet, lossItems = [], ila, signer }) {
  if (!template?.body_html) throw new Error('renderFsrHtml: template.body_html is required');

  const context = buildContext({ claim, lossSheet, lossItems, ila, signer });
  return substitute(template.body_html, context);
}

// -----------------------------------------------------------------------------
// buildContext — gather all values + pre-render the table / prose pieces
// -----------------------------------------------------------------------------
export function buildContext({ claim, lossSheet, lossItems = [], ila, signer }) {
  const ctx = {
    claim: {
      ref_number: claim?.ref_number || `#${claim?.id || ''}`,
      claim_number: claim?.claim_number || '',
      insurer_name: claim?.insurer_name || '',
      insured_name: claim?.insured_name || '',
      policy_number: claim?.policy_number || '',
      lob: claim?.lob || '',
      lob_subcategory: claim?.lob_subcategory || '',
      date_loss: fmtDate(claim?.date_loss),
      date_of_intimation: fmtDate(claim?.date_of_intimation),
      registered_at: fmtDate(claim?.registered_at),
      loss_location: claim?.loss_location || '',
    },
    loss_sheet: {
      sum_insured_inr: fmtINR(lossSheet?.sum_insured),
      value_at_risk_inr: fmtINR(lossSheet?.value_at_risk),
      gross_loss_inr: fmtINR(lossSheet?.gross_loss),
      adjusted_loss_inr: fmtINR(lossSheet?.adjusted_loss),
      net_payable_inr: fmtINR(lossSheet?.net_payable),
      excess_inr: fmtINR(lossSheet?.excess_amount),
      total_salvage_inr: fmtINR(sumSalvage(lossItems)),
      underinsurance_factor_pct: fmtUnderinsuranceFactor(lossSheet?.underinsurance_factor),
      underinsurance_paragraph: underinsuranceParagraph(lossSheet),
    },
    ila: {
      preliminary_view: ila?.preliminary_view || '(no preliminary view recorded)',
      admissibility_label: ADMISSIBILITY_LABELS[ila?.admissibility_opinion] || 'Pending assessment',
      admissibility_reasoning: ila?.admissibility_reasoning || '',
    },
    signer: {
      name: signer?.name || signer?.email || '(unsigned)',
      license: signer?.license_number || '',
    },
    date_today: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    loss_items_table: renderLossItemsTable(lossItems),
  };
  return ctx;
}

// -----------------------------------------------------------------------------
// renderLossItemsTable — pre-rendered HTML, trusted (we built it)
// -----------------------------------------------------------------------------
export function renderLossItemsTable(items = []) {
  if (!items.length) {
    return '<p style="color: #64748b; font-size: 10pt;">No itemised loss recorded.</p>';
  }

  const rows = items.map((item) => `
    <tr>
      <td>${escapeHtml(item.item_no)}</td>
      <td>${escapeHtml(item.description)}${item.notes ? `<br/><span style="font-size: 9pt; color: #64748b;">${escapeHtml(item.notes)}</span>` : ''}</td>
      <td>${escapeHtml(item.category || '')}</td>
      <td class="num">${fmtINR(item.replacement_value)}</td>
      <td class="num">${fmtNumber(item.age_years, 2) || '—'}</td>
      <td class="num">${fmtNumber(item.depreciation_pct, 2)}${item.depreciation_pct_override ? ' †' : ''}</td>
      <td class="num">${fmtINR(item.depreciated_value)}</td>
      <td class="num">${fmtINR(item.salvage_value)}</td>
      <td class="num"><strong>${fmtINR(item.net_loss)}</strong></td>
    </tr>`).join('');

  return `
<table class="loss">
  <thead>
    <tr>
      <th>#</th>
      <th>Description</th>
      <th>Category</th>
      <th>RV</th>
      <th>Age (yrs)</th>
      <th>Dep %</th>
      <th>Dep'd value</th>
      <th>Salvage</th>
      <th>Net loss</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

// -----------------------------------------------------------------------------
// underinsuranceParagraph — prose summary appropriate for the FSR §3
// -----------------------------------------------------------------------------
export function underinsuranceParagraph(lossSheet = {}) {
  const si = Number(lossSheet.sum_insured);
  const var_total = Number(lossSheet.value_at_risk);
  const factor = lossSheet.underinsurance_factor;

  if (!Number.isFinite(si) || si <= 0) {
    return 'Sum insured is not recorded — adequacy of sum insured cannot be assessed at this stage.';
  }
  if (!Number.isFinite(var_total) || var_total <= 0) {
    return `Sum insured of ${fmtINR(si)} on the policy. Value at risk has not been quantified yet — adequacy of sum insured will be reviewed in the supplementary report once the loss sheet is complete.`;
  }
  if (factor === null || factor === undefined) {
    return `Sum insured ${fmtINR(si)} against value at risk ${fmtINR(var_total)}. Underinsurance has not been computed.`;
  }
  if (factor >= 1) {
    return `Sum insured of ${fmtINR(si)} fully covers the value at risk of ${fmtINR(var_total)}. The policy is adequately insured; no underinsurance applies.`;
  }
  const shortfallPct = ((1 - factor) * 100).toFixed(2);
  return `Sum insured of ${fmtINR(si)} against the value at risk of ${fmtINR(var_total)} indicates underinsurance to the extent of ${shortfallPct}%. As per condition of average, the assessed loss is reduced proportionately by the factor ${factor.toFixed(4)}.`;
}

// -----------------------------------------------------------------------------
// substitute — pure {{a.b.c}} resolver
// -----------------------------------------------------------------------------
export function substitute(template, context) {
  if (typeof template !== 'string') return '';
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g, (whole, path) => {
    const value = resolvePath(context, path);
    if (value === undefined || value === null || value === '') return '(blank)';
    if (path === 'loss_items_table') return String(value);  // trust pre-built HTML
    return escapeHtml(value);
  });
}

function resolvePath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[key];
  }, obj);
}

// -----------------------------------------------------------------------------
// formatting helpers
// -----------------------------------------------------------------------------

export function fmtINR(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return INR_FORMATTER.format(n);
}

export function fmtNumber(value, decimals = 2) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(decimals);
}

export function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtUnderinsuranceFactor(factor) {
  if (factor === null || factor === undefined) return 'Not applicable';
  const n = Number(factor);
  if (!Number.isFinite(n)) return 'Not applicable';
  if (n >= 1) return 'Nil (fully insured)';
  return `${(n * 100).toFixed(2)}% applied`;
}

function sumSalvage(items = []) {
  return items.reduce((s, i) => s + (Number(i.salvage_value) || 0), 0);
}

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

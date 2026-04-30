-- =============================================================================
-- FSR LOB templates — DB-driven Fire FSR (CLAUDE.md §11 #5)
-- =============================================================================
-- 30 Apr 2026
--
-- Moves Fire FSR template from hardcoded strings (the existing reality —
-- per CLAUDE.md §3 "Fire/Marine FSR templates are still hardcoded strings")
-- into a DB-driven model where each (company, lob) pair has a versioned
-- HTML body with {{handlebars-style}} placeholders.
--
-- Why a separate table from `fsr_templates`?
--   The existing fsr_templates table is heavily Extended-Warranty-shaped
--   (~30 columns of EW-specific letterhead / section titles). Fire has
--   different sections (Cause / Nature / Adequacy of SI / Liability /
--   Recommendation / Salvage) and pulls heavily from the loss sheet.
--   Cleaner to keep EW on its existing table and use a purpose-built
--   shape here that scales to Marine Cargo / Engineering / etc.
--
-- Placeholder language (resolved by lib/fsr/render.js):
--   {{claim.ref_number}}      claim columns
--   {{claim.insured_name}}
--   {{loss_sheet.gross_loss}} loss-sheet summary fields (already INR)
--   {{loss_sheet.net_payable}}
--   {{ila.preliminary_view}}  latest approved ILA submission's draft
--   {{loss_items_table}}      pre-rendered <table> of line items
--   {{date_today}}            ISO date
--   {{company.name}}          NISLA / Acuere name + license
--
-- Missing placeholders render as the literal string "(blank)" so the PDF
-- never has unrendered tokens.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.fsr_lob_templates (
    id              BIGSERIAL    PRIMARY KEY,
    company         TEXT         NOT NULL,
    lob             TEXT         NOT NULL,
    template_name   TEXT         NOT NULL DEFAULT 'Default',
    version         INTEGER      NOT NULL DEFAULT 1,

    body_html       TEXT         NOT NULL,
    notes           TEXT,

    is_active       BOOLEAN      NOT NULL DEFAULT true,

    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by      TEXT,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by      TEXT
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fsr_lob_templates_unique') THEN
        ALTER TABLE public.fsr_lob_templates
            ADD CONSTRAINT fsr_lob_templates_unique
            UNIQUE (company, lob, template_name, version);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fsr_lob_templates_lookup
    ON public.fsr_lob_templates (company, lob, is_active);

ALTER TABLE public.fsr_lob_templates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'fsr_lob_templates'
          AND policyname = 'Allow all access to fsr_lob_templates'
    ) THEN
        CREATE POLICY "Allow all access to fsr_lob_templates" ON public.fsr_lob_templates
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.fsr_lob_templates
    IS 'CLAUDE.md §11 #5: per-(company, lob) FSR HTML body with handlebars-style placeholders. Resolved by lib/fsr/render.js. Phase 2 will extend to Marine Cargo / Engineering / etc.';

-- -----------------------------------------------------------------------------
-- Seed: Fire FSR — NISLA + Acuere variants
-- -----------------------------------------------------------------------------

INSERT INTO public.fsr_lob_templates (company, lob, template_name, body_html) VALUES
('NISLA', 'Fire', 'Default',
'<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>FSR — {{claim.ref_number}}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: ''Times New Roman'', Times, serif; font-size: 11pt; color: #111; line-height: 1.5; }
  .letterhead { border-bottom: 2px solid #1e3a5f; padding-bottom: 10px; margin-bottom: 14px; text-align: center; }
  .letterhead h1 { margin: 0; font-size: 16pt; color: #1e3a5f; letter-spacing: 0.5px; }
  .letterhead .sub { font-size: 9pt; color: #475569; margin-top: 2px; }
  .doc-title { text-align: center; font-size: 14pt; font-weight: 700; margin: 18px 0 4px; color: #1e3a5f; letter-spacing: 0.5px; }
  .doc-sub { text-align: center; font-size: 10pt; color: #475569; margin-bottom: 16px; }
  table.kv { width: 100%; border-collapse: collapse; margin: 8px 0 14px; }
  table.kv td { padding: 4px 8px; vertical-align: top; }
  table.kv td.k { width: 32%; font-weight: 600; color: #475569; }
  h2 { font-size: 12pt; color: #1e3a5f; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; margin: 18px 0 8px; }
  table.loss { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 8px 0; }
  table.loss th, table.loss td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; }
  table.loss th { background: #f1f5f9; font-weight: 700; }
  table.loss td.num { text-align: right; }
  table.totals { width: 60%; margin: 12px 0 12px auto; border-collapse: collapse; font-size: 11pt; }
  table.totals td { padding: 4px 8px; }
  table.totals tr.grand td { font-weight: 700; border-top: 2px solid #1e3a5f; padding-top: 8px; }
  .signoff { margin-top: 30px; padding-top: 14px; border-top: 1px dashed #94a3b8; }
  .footer { margin-top: 30px; font-size: 8pt; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  .annex { page-break-before: always; }
</style>
</head>
<body>

<div class="letterhead">
  <h1>NATHANI INSURANCE SURVEYORS &amp; LOSS ASSESSORS PVT. LTD.</h1>
  <div class="sub">IRDAI Licence: IRDAI/CORP/SLA-200025 · Surveyors &amp; Loss Assessors</div>
  <div class="sub">Head Office: 507, Garnet Palladium, Goregaon-E, Mumbai – 400063</div>
</div>

<div class="doc-title">FINAL SURVEY REPORT</div>
<div class="doc-sub">Submitted under IRDAI Surveyors and Loss Assessors Regulations, 2015</div>

<table class="kv">
  <tr><td class="k">Surveyor reference</td><td><strong>{{claim.ref_number}}</strong></td></tr>
  <tr><td class="k">Insurer</td><td>{{claim.insurer_name}}</td></tr>
  <tr><td class="k">Insurer claim number</td><td>{{claim.claim_number}}</td></tr>
  <tr><td class="k">Insured</td><td>{{claim.insured_name}}</td></tr>
  <tr><td class="k">Policy number</td><td>{{claim.policy_number}}</td></tr>
  <tr><td class="k">LOB / sub-category</td><td>{{claim.lob}} — {{claim.lob_subcategory}}</td></tr>
  <tr><td class="k">Date of loss</td><td>{{claim.date_loss}}</td></tr>
  <tr><td class="k">Date of intimation</td><td>{{claim.date_of_intimation}}</td></tr>
  <tr><td class="k">Date of assignment</td><td>{{claim.registered_at}}</td></tr>
  <tr><td class="k">Loss location</td><td>{{claim.loss_location}}</td></tr>
  <tr><td class="k">Sum insured</td><td>{{loss_sheet.sum_insured_inr}}</td></tr>
</table>

<h2>1. Cause of loss</h2>
<p>{{ila.preliminary_view}}</p>

<h2>2. Nature and extent of loss</h2>
<p>The damaged property comprises the items listed in <strong>Annexure-A</strong> below. The aggregate value at risk has been computed as <strong>{{loss_sheet.value_at_risk_inr}}</strong>; the gross loss after item-wise depreciation is <strong>{{loss_sheet.gross_loss_inr}}</strong>.</p>

<h2>3. Adequacy of sum insured</h2>
<p>{{loss_sheet.underinsurance_paragraph}}</p>

<h2>4. Liability under policy</h2>
<p><strong>Admissibility opinion:</strong> {{ila.admissibility_label}}</p>
<p>{{ila.admissibility_reasoning}}</p>

<h2>5. Recommended settlement</h2>
<table class="totals">
  <tr><td>Gross Loss</td><td class="num">{{loss_sheet.gross_loss_inr}}</td></tr>
  <tr><td>Less: Underinsurance applied</td><td class="num">{{loss_sheet.underinsurance_factor_pct}}</td></tr>
  <tr><td>Adjusted Loss</td><td class="num">{{loss_sheet.adjusted_loss_inr}}</td></tr>
  <tr><td>Less: Excess / deductible</td><td class="num">{{loss_sheet.excess_inr}}</td></tr>
  <tr class="grand"><td>Net Payable</td><td class="num">{{loss_sheet.net_payable_inr}}</td></tr>
</table>

<h2>6. Salvage</h2>
<p>Salvage value of {{loss_sheet.total_salvage_inr}} has been computed item-wise (see Annexure-A) and deducted from the depreciated value of each affected item before arriving at the net loss.</p>

<div class="signoff">
  <p><strong>Signed by:</strong></p>
  <p style="margin-top: 22px;">
    <strong>{{signer.name}}</strong><br/>
    IRDAI Licence: {{signer.license}}<br/>
    For Nathani Insurance Surveyors and Loss Assessors Pvt. Ltd.<br/>
    <span style="font-size: 9pt; color: #64748b;">Date: {{date_today}}</span>
  </p>
</div>

<div class="footer">
  Generated by NISLA Portal · Surveyor reference {{claim.ref_number}} · Page 1
</div>

<!-- Annexure-A: itemised loss sheet -->
<div class="annex">
  <h2 style="margin-top: 0;">Annexure-A — Itemised Loss Sheet</h2>
  {{loss_items_table}}
  <p style="font-size: 9pt; color: #475569; margin-top: 14px;">
    Depreciation rates applied per item-category curves (config/depreciation.js). Manual overrides are flagged with †.
  </p>
</div>

</body>
</html>'),

('Acuere', 'Fire', 'Default',
'<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>FSR — {{claim.ref_number}}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: ''Times New Roman'', Times, serif; font-size: 11pt; color: #111; line-height: 1.5; }
  .letterhead { border-bottom: 2px solid #1a7ab5; padding-bottom: 10px; margin-bottom: 14px; text-align: center; }
  .letterhead h1 { margin: 0; font-size: 16pt; color: #1a7ab5; letter-spacing: 0.5px; }
  .letterhead .sub { font-size: 9pt; color: #475569; margin-top: 2px; }
  .doc-title { text-align: center; font-size: 14pt; font-weight: 700; margin: 18px 0 4px; color: #1a7ab5; letter-spacing: 0.5px; }
  .doc-sub { text-align: center; font-size: 10pt; color: #475569; margin-bottom: 16px; }
  table.kv { width: 100%; border-collapse: collapse; margin: 8px 0 14px; }
  table.kv td { padding: 4px 8px; vertical-align: top; }
  table.kv td.k { width: 32%; font-weight: 600; color: #475569; }
  h2 { font-size: 12pt; color: #1a7ab5; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; margin: 18px 0 8px; }
  table.loss { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 8px 0; }
  table.loss th, table.loss td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; }
  table.loss th { background: #f1f5f9; font-weight: 700; }
  table.loss td.num { text-align: right; }
  table.totals { width: 60%; margin: 12px 0 12px auto; border-collapse: collapse; font-size: 11pt; }
  table.totals td { padding: 4px 8px; }
  table.totals tr.grand td { font-weight: 700; border-top: 2px solid #1a7ab5; padding-top: 8px; }
  .signoff { margin-top: 30px; padding-top: 14px; border-top: 1px dashed #94a3b8; }
  .footer { margin-top: 30px; font-size: 8pt; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  .annex { page-break-before: always; }
</style>
</head>
<body>

<div class="letterhead">
  <h1>ACUERE SURVEYORS</h1>
  <div class="sub">IRDAI Licence: IRDAI/IND/SLA-85225 · Surveyors &amp; Loss Assessors</div>
  <div class="sub">507, Garnet Palladium, Panch-Bawadi, Goregaon (E), Mumbai – 400063</div>
</div>

<div class="doc-title">FINAL SURVEY REPORT</div>
<div class="doc-sub">Submitted under IRDAI Surveyors and Loss Assessors Regulations, 2015</div>

<table class="kv">
  <tr><td class="k">Surveyor reference</td><td><strong>{{claim.ref_number}}</strong></td></tr>
  <tr><td class="k">Insurer</td><td>{{claim.insurer_name}}</td></tr>
  <tr><td class="k">Insurer claim number</td><td>{{claim.claim_number}}</td></tr>
  <tr><td class="k">Insured</td><td>{{claim.insured_name}}</td></tr>
  <tr><td class="k">Policy number</td><td>{{claim.policy_number}}</td></tr>
  <tr><td class="k">LOB / sub-category</td><td>{{claim.lob}} — {{claim.lob_subcategory}}</td></tr>
  <tr><td class="k">Date of loss</td><td>{{claim.date_loss}}</td></tr>
  <tr><td class="k">Date of intimation</td><td>{{claim.date_of_intimation}}</td></tr>
  <tr><td class="k">Date of assignment</td><td>{{claim.registered_at}}</td></tr>
  <tr><td class="k">Loss location</td><td>{{claim.loss_location}}</td></tr>
  <tr><td class="k">Sum insured</td><td>{{loss_sheet.sum_insured_inr}}</td></tr>
</table>

<h2>1. Cause of loss</h2>
<p>{{ila.preliminary_view}}</p>

<h2>2. Nature and extent of loss</h2>
<p>The damaged property comprises the items listed in <strong>Annexure-A</strong> below. The aggregate value at risk has been computed as <strong>{{loss_sheet.value_at_risk_inr}}</strong>; the gross loss after item-wise depreciation is <strong>{{loss_sheet.gross_loss_inr}}</strong>.</p>

<h2>3. Adequacy of sum insured</h2>
<p>{{loss_sheet.underinsurance_paragraph}}</p>

<h2>4. Liability under policy</h2>
<p><strong>Admissibility opinion:</strong> {{ila.admissibility_label}}</p>
<p>{{ila.admissibility_reasoning}}</p>

<h2>5. Recommended settlement</h2>
<table class="totals">
  <tr><td>Gross Loss</td><td class="num">{{loss_sheet.gross_loss_inr}}</td></tr>
  <tr><td>Less: Underinsurance applied</td><td class="num">{{loss_sheet.underinsurance_factor_pct}}</td></tr>
  <tr><td>Adjusted Loss</td><td class="num">{{loss_sheet.adjusted_loss_inr}}</td></tr>
  <tr><td>Less: Excess / deductible</td><td class="num">{{loss_sheet.excess_inr}}</td></tr>
  <tr class="grand"><td>Net Payable</td><td class="num">{{loss_sheet.net_payable_inr}}</td></tr>
</table>

<h2>6. Salvage</h2>
<p>Salvage value of {{loss_sheet.total_salvage_inr}} has been computed item-wise (see Annexure-A) and deducted from the depreciated value of each affected item.</p>

<div class="signoff">
  <p><strong>Signed by:</strong></p>
  <p style="margin-top: 22px;">
    <strong>{{signer.name}}</strong><br/>
    IRDAI Licence: {{signer.license}}<br/>
    For Acuere Surveyors<br/>
    <span style="font-size: 9pt; color: #64748b;">Date: {{date_today}}</span>
  </p>
</div>

<div class="footer">
  Generated by NISLA Portal · Surveyor reference {{claim.ref_number}} · Page 1
</div>

<div class="annex">
  <h2 style="margin-top: 0;">Annexure-A — Itemised Loss Sheet</h2>
  {{loss_items_table}}
  <p style="font-size: 9pt; color: #475569; margin-top: 14px;">
    Depreciation rates applied per item-category curves. Manual overrides are flagged with †.
  </p>
</div>

</body>
</html>')
ON CONFLICT (company, lob, template_name, version) DO NOTHING;

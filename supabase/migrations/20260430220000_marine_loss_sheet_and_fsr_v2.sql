-- =============================================================================
-- Marine Cargo loss sheet + Fire FSR v2 + Marine Cargo FSR seed
-- =============================================================================
-- 30 Apr 2026
--
-- Three things in this migration:
--   1. marine_loss_sheets + marine_loss_sheet_items   New tables for the
--      Marine Cargo math flow which differs from Fire (no depreciation;
--      insurance % + GST + handling % flow). Source of truth: real
--      Kansai Nerolac (4771-25-26) and Qutone Ceramic (4301-25-26)
--      working sheets shared by NISLA management.
--   2. Fire FSR v2 (NISLA + Acuere)                   Replaces the v1
--      template I shipped in 20260430210000. v1 had the right shape but
--      was missing the production-format sections from the SK Polyfoams
--      reference (3472-24-25 FSR.docx): subject block, CLAIM DETAILS
--      (a–j) table, POLICY PARTICULARS (a–j) with sum-insured
--      breakdown, ABOUT INSURED narrative, INCIDENT (quoted insured
--      statement), Police GD, Fire Brigade Report, OUR OBSERVATIONS.
--      v2 is inserted as a new row so v1 history is preserved.
--   3. Marine Cargo FSR seed (NISLA + Acuere)         Mirrors the v2
--      Fire structure but with Marine Cargo line-item table and Marine
--      math summary in the recommended-settlement section.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. marine_loss_sheets
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.marine_loss_sheets (
    id                   BIGSERIAL    PRIMARY KEY,
    claim_id             BIGINT       NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,

    -- Inputs (Marine flow specifics)
    insurance_rate_pct   NUMERIC(5,2) NOT NULL DEFAULT 1.00,       -- e.g. 1% of invoice
    gst_rate_pct         NUMERIC(5,2) NOT NULL DEFAULT 18.00,
    handling_rate_pct    NUMERIC(5,2) NOT NULL DEFAULT 10.00,      -- "Add 10%" sundry / handling
    excess_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
    salvage_amount       NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Computed totals (denormalised — refreshed on every line change)
    subtotal_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,         -- sum of damaged-qty × rate
    insurance_total      NUMERIC(15,2) NOT NULL DEFAULT 0,         -- sum of per-line insurance
    pre_gst_total        NUMERIC(15,2) NOT NULL DEFAULT 0,         -- subtotal + insurance
    gst_amount           NUMERIC(15,2) NOT NULL DEFAULT 0,
    after_gst_total      NUMERIC(15,2) NOT NULL DEFAULT 0,         -- pre_gst + gst (the spec sheet's "Net Loss" mid-point)
    handling_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
    after_handling_total NUMERIC(15,2) NOT NULL DEFAULT 0,         -- after_gst + handling
    net_loss             NUMERIC(15,2) NOT NULL DEFAULT 0,         -- after_handling − salvage
    net_adjusted_loss    NUMERIC(15,2) NOT NULL DEFAULT 0,         -- net_loss − excess (floor 0)

    -- Workflow
    status               TEXT         NOT NULL DEFAULT 'draft',
    notes                TEXT,

    company              TEXT         NOT NULL DEFAULT 'NISLA',
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by           TEXT,
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by           TEXT
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marine_loss_sheets_claim_unique') THEN
        ALTER TABLE public.marine_loss_sheets
            ADD CONSTRAINT marine_loss_sheets_claim_unique UNIQUE (claim_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marine_loss_sheets_status_check') THEN
        ALTER TABLE public.marine_loss_sheets
            ADD CONSTRAINT marine_loss_sheets_status_check
            CHECK (status IN ('draft', 'under_review', 'approved', 'superseded'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_marine_loss_sheets_claim ON public.marine_loss_sheets (claim_id);

ALTER TABLE public.marine_loss_sheets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'marine_loss_sheets'
          AND policyname = 'Allow all access to marine_loss_sheets'
    ) THEN
        CREATE POLICY "Allow all access to marine_loss_sheets" ON public.marine_loss_sheets
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.marine_loss_sheets
    IS 'Marine Cargo claim header. Math flow per Kansai Nerolac / Qutone Ceramic working sheets: subtotal + insurance% + GST% + handling% − salvage − excess. No depreciation (Marine cargo = goods value).';

-- -----------------------------------------------------------------------------
-- 2. marine_loss_sheet_items
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.marine_loss_sheet_items (
    id                   BIGSERIAL    PRIMARY KEY,
    marine_sheet_id      BIGINT       NOT NULL REFERENCES public.marine_loss_sheets(id) ON DELETE CASCADE,
    claim_id             BIGINT       NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,

    item_no              INTEGER      NOT NULL,

    -- Identification (matches the working-sheet column shape)
    lr_no                TEXT,                              -- Lorry / consignment receipt
    invoice_no           TEXT,
    code                 TEXT,                              -- product / SKU code
    description          TEXT         NOT NULL,
    pack_size            TEXT,                              -- '20L', '17 box', etc.
    unit                 TEXT,

    -- Quantification
    damaged_qty          NUMERIC(15,4) NOT NULL DEFAULT 1,
    rate                 NUMERIC(15,2) NOT NULL DEFAULT 0,
    amount               NUMERIC(15,2) NOT NULL DEFAULT 0,  -- damaged_qty × rate

    insurance_rate_pct   NUMERIC(5,2),                       -- per-line override of sheet default
    insurance_value      NUMERIC(15,2) NOT NULL DEFAULT 0,  -- amount × insurance_rate_pct / 100

    line_total           NUMERIC(15,2) NOT NULL DEFAULT 0,  -- amount + insurance_value

    notes                TEXT,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marine_loss_sheet_items_unique_no') THEN
        ALTER TABLE public.marine_loss_sheet_items
            ADD CONSTRAINT marine_loss_sheet_items_unique_no UNIQUE (marine_sheet_id, item_no);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_marine_items_sheet ON public.marine_loss_sheet_items (marine_sheet_id);
CREATE INDEX IF NOT EXISTS idx_marine_items_claim ON public.marine_loss_sheet_items (claim_id);

ALTER TABLE public.marine_loss_sheet_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'marine_loss_sheet_items'
          AND policyname = 'Allow all access to marine_loss_sheet_items'
    ) THEN
        CREATE POLICY "Allow all access to marine_loss_sheet_items" ON public.marine_loss_sheet_items
            USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Fire FSR v2 — full production-format template (NISLA + Acuere)
-- -----------------------------------------------------------------------------
-- v1 from 20260430210000 stays as history; v2 is now the active template
-- because the API picks `is_active=true ORDER BY version DESC LIMIT 1`.
-- v1 must be deactivated for v2 to win.

UPDATE public.fsr_lob_templates
   SET is_active = false, updated_at = NOW()
 WHERE company IN ('NISLA', 'Acuere')
   AND lob = 'Fire'
   AND template_name = 'Default'
   AND version = 1;

INSERT INTO public.fsr_lob_templates (company, lob, template_name, version, body_html) VALUES
('NISLA', 'Fire', 'Default', 2,
'<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>FSR — {{claim.ref_number}}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: ''Times New Roman'', Times, serif; font-size: 11pt; color: #111; line-height: 1.45; }
  .letterhead { text-align: center; border-bottom: 2px solid #1e3a5f; padding-bottom: 8px; margin-bottom: 12px; }
  .letterhead h1 { margin: 0; font-size: 14pt; color: #1e3a5f; }
  .letterhead .sub { font-size: 9pt; color: #475569; margin-top: 2px; }
  .ref-line { display: flex; justify-content: space-between; font-size: 10pt; margin: 8px 0; }
  .doc-title { text-align: center; font-size: 13pt; font-weight: 700; margin: 14px 0 4px; color: #1e3a5f; }
  .doc-sub { text-align: center; font-size: 10pt; color: #475569; margin-bottom: 12px; font-style: italic; }
  .to-block { font-size: 10pt; margin: 12px 0; line-height: 1.4; }
  .subject { font-size: 10pt; font-weight: 700; margin: 12px 0; padding: 8px; background: #f8fafc; border-left: 3px solid #1e3a5f; }
  h2 { font-size: 11pt; color: #1e3a5f; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.3px; }
  table.kv { width: 100%; border-collapse: collapse; margin: 6px 0 12px; }
  table.kv td { padding: 4px 6px; vertical-align: top; border: 1px solid #e2e8f0; font-size: 10pt; }
  table.kv td.lbl { width: 4%; font-weight: 600; color: #475569; text-align: center; }
  table.kv td.k   { width: 24%; font-weight: 600; color: #475569; }
  table.si { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 10pt; }
  table.si th, table.si td { border: 1px solid #cbd5e1; padding: 4px 6px; }
  table.si th { background: #f1f5f9; }
  table.si td.num { text-align: right; }
  table.loss { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 8px 0; }
  table.loss th, table.loss td { border: 1px solid #cbd5e1; padding: 3px 5px; }
  table.loss th { background: #f1f5f9; font-weight: 700; }
  table.loss td.num { text-align: right; }
  table.totals { width: 65%; margin: 12px 0 12px auto; border-collapse: collapse; font-size: 11pt; }
  table.totals td { padding: 4px 8px; }
  table.totals tr.grand td { font-weight: 700; border-top: 2px solid #1e3a5f; padding-top: 8px; }
  blockquote { border-left: 3px solid #cbd5e1; margin: 8px 0; padding: 4px 12px; font-style: italic; color: #334155; background: #f8fafc; }
  .signoff { margin-top: 30px; padding-top: 12px; border-top: 1px dashed #94a3b8; }
  .footer { margin-top: 24px; font-size: 8pt; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 6px; }
  .annex { page-break-before: always; }
  p { margin: 6px 0; }
</style>
</head>
<body>

<div class="letterhead">
  <h1>NATHANI INSURANCE SURVEYORS &amp; LOSS ASSESSORS PVT. LTD.</h1>
  <div class="sub">IRDA/CORP/S.L.A. No. 200025 (Exp. 03/10/2028)</div>
  <div class="sub">507, Garnet Palladium, Behind Express Zone, Off WE Highway, Goregaon (E), Mumbai – 400063</div>
  <div class="sub">Mobile: 9892171640, 9890084540 | Email: pranav.kumar554@gmail.com, nathani.surveyors@gmail.com</div>
</div>

<div class="ref-line">
  <span><strong>Ref. No:</strong> {{claim.ref_number}}</span>
  <span><strong>Date:</strong> {{date_today}}</span>
</div>

<div class="doc-title">FINAL SURVEY REPORT</div>
<div class="doc-sub">(WITHOUT PREJUDICE)</div>

<div class="to-block">
  <strong>To,</strong><br/>
  The Claim In-Charge<br/>
  {{claim.insurer_name}}<br/>
  <em>(Address as per policy schedule)</em>
</div>

<div class="subject">
  <strong>Subject:</strong> Reported loss / damage due to fire on {{claim.date_loss}} || Policy No: {{claim.policy_number}} || Insured: {{claim.insured_name}} || Claim No: {{claim.claim_number}}
</div>

<p>Dear Sir,</p>
<p>Pursuant to valued instruction received from {{claim.insurer_name}} on {{claim.date_of_intimation}} for survey and loss assessment of the captioned claim, we made immediate contact with the insured’s representative and conducted the survey as per the details below.</p>

<h2>1. Claim details</h2>
<table class="kv">
  <tr><td class="lbl">a</td><td class="k">Loss details</td><td>{{ila.preliminary_view}}</td></tr>
  <tr><td class="lbl">b</td><td class="k">Date of loss</td><td>{{claim.date_loss}}</td></tr>
  <tr><td class="lbl">c</td><td class="k">Date of intimation</td><td>{{claim.date_of_intimation}}</td></tr>
  <tr><td class="lbl">d</td><td class="k">Date of assignment / survey</td><td>{{claim.registered_at}}</td></tr>
  <tr><td class="lbl">e</td><td class="k">Insured</td><td>{{claim.insured_name}}</td></tr>
  <tr><td class="lbl">f</td><td class="k">Loss location</td><td>{{claim.loss_location}}</td></tr>
  <tr><td class="lbl">g</td><td class="k">Insurer</td><td>{{claim.insurer_name}}</td></tr>
  <tr><td class="lbl">h</td><td class="k">Policy No.</td><td>{{claim.policy_number}}</td></tr>
  <tr><td class="lbl">i</td><td class="k">Claim No.</td><td>{{claim.claim_number}}</td></tr>
  <tr><td class="lbl">j</td><td class="k">Estimated loss</td><td>{{loss_sheet.gross_loss_inr}}</td></tr>
</table>

<h2>2. Policy particulars</h2>
<table class="kv">
  <tr><td class="lbl">a</td><td class="k">Policy No.</td><td>{{claim.policy_number}}</td></tr>
  <tr><td class="lbl">b</td><td class="k">Insured</td><td>{{claim.insured_name}}</td></tr>
  <tr><td class="lbl">c</td><td class="k">Policy type</td><td>{{claim.lob_subcategory}}</td></tr>
  <tr><td class="lbl">d</td><td class="k">Insurer</td><td>{{claim.insurer_name}}</td></tr>
  <tr><td class="lbl">e</td><td class="k">Risk location</td><td>{{claim.loss_location}}</td></tr>
  <tr><td class="lbl">f</td><td class="k">Sum insured</td><td>{{loss_sheet.sum_insured_inr}}</td></tr>
  <tr><td class="lbl">g</td><td class="k">Policy excess</td><td>{{loss_sheet.excess_inr}}</td></tr>
</table>

<h2>3. About insured</h2>
<p>{{narrative.about_insured}}</p>

<h2>4. About the incident</h2>
<p>The insured’s representative has briefed us about the incident as below:</p>
<blockquote>{{narrative.incident_quote}}</blockquote>
<p><em>The incident reported by the insured has been reproduced verbatim without corrections to spelling and/or grammar.</em></p>

<h2>5. General Diary / Police Panchnama</h2>
<p>{{narrative.police_gd}}</p>

<h2>6. Fire Brigade report</h2>
<p>{{narrative.fire_brigade}}</p>

<h2>7. Our observations / inspection &amp; findings</h2>
<p>{{narrative.observations}}</p>

<h2>8. Cause of loss</h2>
<p>{{ila.preliminary_view}}</p>

<h2>9. Adequacy of sum insured</h2>
<p>{{loss_sheet.underinsurance_paragraph}}</p>

<h2>10. Liability under policy</h2>
<p><strong>Admissibility opinion:</strong> {{ila.admissibility_label}}</p>
<p>{{ila.admissibility_reasoning}}</p>

<h2>11. Recommended settlement</h2>
<table class="totals">
  <tr><td>Gross Loss (per Annexure-A)</td><td class="num">{{loss_sheet.gross_loss_inr}}</td></tr>
  <tr><td>Less: Underinsurance applied</td><td class="num">{{loss_sheet.underinsurance_factor_pct}}</td></tr>
  <tr><td>Adjusted Loss</td><td class="num">{{loss_sheet.adjusted_loss_inr}}</td></tr>
  <tr><td>Less: Salvage</td><td class="num">{{loss_sheet.total_salvage_inr}}</td></tr>
  <tr><td>Less: Excess / deductible</td><td class="num">{{loss_sheet.excess_inr}}</td></tr>
  <tr class="grand"><td>Net Payable</td><td class="num">{{loss_sheet.net_payable_inr}}</td></tr>
</table>

<div class="signoff">
  <p><strong>Signed by:</strong></p>
  <p style="margin-top: 22px;">
    <strong>{{signer.name}}</strong><br/>
    IRDAI Licence: {{signer.license}}<br/>
    For Nathani Insurance Surveyors and Loss Assessors Pvt. Ltd.<br/>
    <span style="font-size: 9pt; color: #64748b;">Date: {{date_today}}</span>
  </p>
</div>

<p style="font-size: 9pt; color: #64748b; margin-top: 18px;"><em>This report is furnished without prejudice to the rights, liabilities, terms and conditions of the policy issued by the insurer. This report is based on facts and information made available and known to us at the time of survey. If any new facts come to our notice, the same shall be incorporated in a subsequent / supplementary report.</em></p>

<div class="footer">
  Generated by NISLA Portal · Surveyor reference {{claim.ref_number}}
</div>

<div class="annex">
  <h2 style="margin-top: 0;">Annexure-A — Itemised Loss Sheet</h2>
  {{loss_items_table}}
  <p style="font-size: 9pt; color: #475569; margin-top: 14px;">
    Depreciation rates applied per item-category curves (config/depreciation.js). Manual overrides flagged with †.
  </p>
</div>

</body>
</html>'),

('Acuere', 'Fire', 'Default', 2,
'<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>FSR — {{claim.ref_number}}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: ''Times New Roman'', Times, serif; font-size: 11pt; color: #111; line-height: 1.45; }
  .letterhead { text-align: center; border-bottom: 2px solid #1a7ab5; padding-bottom: 8px; margin-bottom: 12px; }
  .letterhead h1 { margin: 0; font-size: 14pt; color: #1a7ab5; }
  .letterhead .sub { font-size: 9pt; color: #475569; margin-top: 2px; }
  .ref-line { display: flex; justify-content: space-between; font-size: 10pt; margin: 8px 0; }
  .doc-title { text-align: center; font-size: 13pt; font-weight: 700; margin: 14px 0 4px; color: #1a7ab5; }
  .doc-sub { text-align: center; font-size: 10pt; color: #475569; margin-bottom: 12px; font-style: italic; }
  .to-block { font-size: 10pt; margin: 12px 0; line-height: 1.4; }
  .subject { font-size: 10pt; font-weight: 700; margin: 12px 0; padding: 8px; background: #f8fafc; border-left: 3px solid #1a7ab5; }
  h2 { font-size: 11pt; color: #1a7ab5; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.3px; }
  table.kv { width: 100%; border-collapse: collapse; margin: 6px 0 12px; }
  table.kv td { padding: 4px 6px; vertical-align: top; border: 1px solid #e2e8f0; font-size: 10pt; }
  table.kv td.lbl { width: 4%; font-weight: 600; color: #475569; text-align: center; }
  table.kv td.k   { width: 24%; font-weight: 600; color: #475569; }
  table.totals { width: 65%; margin: 12px 0 12px auto; border-collapse: collapse; font-size: 11pt; }
  table.totals td { padding: 4px 8px; }
  table.totals tr.grand td { font-weight: 700; border-top: 2px solid #1a7ab5; padding-top: 8px; }
  table.loss { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 8px 0; }
  table.loss th, table.loss td { border: 1px solid #cbd5e1; padding: 3px 5px; }
  table.loss th { background: #f1f5f9; font-weight: 700; }
  table.loss td.num { text-align: right; }
  blockquote { border-left: 3px solid #cbd5e1; margin: 8px 0; padding: 4px 12px; font-style: italic; color: #334155; background: #f8fafc; }
  .signoff { margin-top: 30px; padding-top: 12px; border-top: 1px dashed #94a3b8; }
  .footer { margin-top: 24px; font-size: 8pt; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 6px; }
  .annex { page-break-before: always; }
  p { margin: 6px 0; }
</style>
</head>
<body>
<div class="letterhead">
  <h1>ACUERE SURVEYORS</h1>
  <div class="sub">IRDA Licence: IRDAI/IND/SLA-85225 (Exp. 02/03/2028)</div>
  <div class="sub">507, Garnet Palladium, Panch-Bawadi, Goregaon (E), Mumbai – 400063</div>
  <div class="sub">Contact: 9892976754 | Email: niteennathani@gmail.com, acueresurveyors@gmail.com</div>
</div>
<div class="ref-line"><span><strong>Ref. No:</strong> {{claim.ref_number}}</span><span><strong>Date:</strong> {{date_today}}</span></div>
<div class="doc-title">FINAL SURVEY REPORT</div>
<div class="doc-sub">(WITHOUT PREJUDICE)</div>
<div class="to-block"><strong>To,</strong><br/>The Claim In-Charge<br/>{{claim.insurer_name}}</div>
<div class="subject"><strong>Subject:</strong> Reported loss / damage due to fire on {{claim.date_loss}} || Policy: {{claim.policy_number}} || Insured: {{claim.insured_name}} || Claim: {{claim.claim_number}}</div>
<p>Dear Sir,</p>
<p>Pursuant to valued instruction received from {{claim.insurer_name}} on {{claim.date_of_intimation}} we conducted the survey for the captioned claim. Our findings are below.</p>
<h2>1. Claim details</h2>
<table class="kv">
  <tr><td class="lbl">a</td><td class="k">Loss details</td><td>{{ila.preliminary_view}}</td></tr>
  <tr><td class="lbl">b</td><td class="k">Date of loss</td><td>{{claim.date_loss}}</td></tr>
  <tr><td class="lbl">c</td><td class="k">Date of intimation</td><td>{{claim.date_of_intimation}}</td></tr>
  <tr><td class="lbl">d</td><td class="k">Insured</td><td>{{claim.insured_name}}</td></tr>
  <tr><td class="lbl">e</td><td class="k">Loss location</td><td>{{claim.loss_location}}</td></tr>
  <tr><td class="lbl">f</td><td class="k">Insurer</td><td>{{claim.insurer_name}}</td></tr>
  <tr><td class="lbl">g</td><td class="k">Policy No.</td><td>{{claim.policy_number}}</td></tr>
  <tr><td class="lbl">h</td><td class="k">Claim No.</td><td>{{claim.claim_number}}</td></tr>
  <tr><td class="lbl">i</td><td class="k">Sum insured</td><td>{{loss_sheet.sum_insured_inr}}</td></tr>
  <tr><td class="lbl">j</td><td class="k">Estimated loss</td><td>{{loss_sheet.gross_loss_inr}}</td></tr>
</table>
<h2>2. About insured</h2><p>{{narrative.about_insured}}</p>
<h2>3. About the incident</h2><blockquote>{{narrative.incident_quote}}</blockquote>
<h2>4. Police GD / Fire Brigade</h2><p>{{narrative.police_gd}}</p><p>{{narrative.fire_brigade}}</p>
<h2>5. Observations &amp; findings</h2><p>{{narrative.observations}}</p>
<h2>6. Cause of loss</h2><p>{{ila.preliminary_view}}</p>
<h2>7. Adequacy of sum insured</h2><p>{{loss_sheet.underinsurance_paragraph}}</p>
<h2>8. Liability under policy</h2>
<p><strong>Admissibility:</strong> {{ila.admissibility_label}}</p>
<p>{{ila.admissibility_reasoning}}</p>
<h2>9. Recommended settlement</h2>
<table class="totals">
  <tr><td>Gross Loss</td><td class="num">{{loss_sheet.gross_loss_inr}}</td></tr>
  <tr><td>Less: Underinsurance</td><td class="num">{{loss_sheet.underinsurance_factor_pct}}</td></tr>
  <tr><td>Adjusted Loss</td><td class="num">{{loss_sheet.adjusted_loss_inr}}</td></tr>
  <tr><td>Less: Salvage</td><td class="num">{{loss_sheet.total_salvage_inr}}</td></tr>
  <tr><td>Less: Excess</td><td class="num">{{loss_sheet.excess_inr}}</td></tr>
  <tr class="grand"><td>Net Payable</td><td class="num">{{loss_sheet.net_payable_inr}}</td></tr>
</table>
<div class="signoff"><p><strong>Signed by:</strong></p><p style="margin-top: 22px;"><strong>{{signer.name}}</strong><br/>IRDAI Licence: {{signer.license}}<br/>For Acuere Surveyors<br/><span style="font-size: 9pt; color: #64748b;">Date: {{date_today}}</span></p></div>
<div class="footer">Generated by NISLA Portal · Surveyor reference {{claim.ref_number}}</div>
<div class="annex"><h2 style="margin-top: 0;">Annexure-A — Itemised Loss Sheet</h2>{{loss_items_table}}</div>
</body></html>')
ON CONFLICT (company, lob, template_name, version) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. Marine Cargo FSR template (NISLA + Acuere) — Marine math summary
-- -----------------------------------------------------------------------------

INSERT INTO public.fsr_lob_templates (company, lob, template_name, version, body_html) VALUES
('NISLA', 'Marine Cargo', 'Default', 1,
'<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Marine Cargo FSR — {{claim.ref_number}}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: ''Times New Roman'', Times, serif; font-size: 11pt; color: #111; line-height: 1.45; }
  .letterhead { text-align: center; border-bottom: 2px solid #1e3a5f; padding-bottom: 8px; margin-bottom: 12px; }
  .letterhead h1 { margin: 0; font-size: 14pt; color: #1e3a5f; }
  .letterhead .sub { font-size: 9pt; color: #475569; margin-top: 2px; }
  .doc-title { text-align: center; font-size: 13pt; font-weight: 700; margin: 14px 0 4px; color: #1e3a5f; }
  .doc-sub { text-align: center; font-size: 10pt; color: #475569; font-style: italic; margin-bottom: 12px; }
  h2 { font-size: 11pt; color: #1e3a5f; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; margin: 14px 0 6px; text-transform: uppercase; }
  table.kv { width: 100%; border-collapse: collapse; margin: 6px 0 12px; }
  table.kv td { padding: 4px 6px; vertical-align: top; border: 1px solid #e2e8f0; font-size: 10pt; }
  table.kv td.lbl { width: 4%; font-weight: 600; color: #475569; text-align: center; }
  table.kv td.k { width: 24%; font-weight: 600; color: #475569; }
  table.totals { width: 70%; margin: 12px 0 12px auto; border-collapse: collapse; font-size: 11pt; }
  table.totals td { padding: 4px 8px; }
  table.totals tr.grand td { font-weight: 700; border-top: 2px solid #1e3a5f; padding-top: 8px; }
  table.loss { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 8px 0; }
  table.loss th, table.loss td { border: 1px solid #cbd5e1; padding: 3px 5px; }
  table.loss th { background: #f1f5f9; font-weight: 700; }
  table.loss td.num { text-align: right; }
  blockquote { border-left: 3px solid #cbd5e1; margin: 8px 0; padding: 4px 12px; font-style: italic; color: #334155; background: #f8fafc; }
  .signoff { margin-top: 30px; padding-top: 12px; border-top: 1px dashed #94a3b8; }
  .footer { margin-top: 24px; font-size: 8pt; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 6px; }
  .annex { page-break-before: always; }
</style>
</head>
<body>
<div class="letterhead">
  <h1>NATHANI INSURANCE SURVEYORS &amp; LOSS ASSESSORS PVT. LTD.</h1>
  <div class="sub">IRDA/CORP/S.L.A. No. 200025 · 507, Garnet Palladium, Goregaon (E), Mumbai – 400063</div>
</div>
<div class="doc-title">MARINE CARGO — FINAL SURVEY REPORT</div>
<div class="doc-sub">(WITHOUT PREJUDICE)</div>

<h2>1. Claim details</h2>
<table class="kv">
  <tr><td class="lbl">a</td><td class="k">Surveyor reference</td><td><strong>{{claim.ref_number}}</strong></td></tr>
  <tr><td class="lbl">b</td><td class="k">Insurer / claim no.</td><td>{{claim.insurer_name}} / {{claim.claim_number}}</td></tr>
  <tr><td class="lbl">c</td><td class="k">Insured (consignor)</td><td>{{claim.insured_name}}</td></tr>
  <tr><td class="lbl">d</td><td class="k">Policy no.</td><td>{{claim.policy_number}} ({{claim.lob_subcategory}})</td></tr>
  <tr><td class="lbl">e</td><td class="k">Sum insured</td><td>{{loss_sheet.sum_insured_inr}}</td></tr>
  <tr><td class="lbl">f</td><td class="k">Date of loss</td><td>{{claim.date_loss}}</td></tr>
  <tr><td class="lbl">g</td><td class="k">Date of intimation</td><td>{{claim.date_of_intimation}}</td></tr>
  <tr><td class="lbl">h</td><td class="k">Loss location</td><td>{{claim.loss_location}}</td></tr>
</table>

<h2>2. About the consignment</h2><p>{{narrative.about_consignment}}</p>
<h2>3. About the incident</h2><blockquote>{{narrative.incident_quote}}</blockquote>
<h2>4. Cause of loss</h2><p>{{ila.preliminary_view}}</p>
<h2>5. Damage assessment methodology</h2>
<p>The cargo damage was assessed on a per-pack basis, comparing the as-shipped invoice quantities against the as-arrived condition at the destination warehouse. Each damaged pack has been valued at the unit rate per the consignor’s commercial invoice. Insurance value is added at {{loss_sheet.insurance_rate_pct}}% of the invoice value per industry convention. GST of {{loss_sheet.gst_rate_pct}}% and a sundry / handling overhead of {{loss_sheet.handling_rate_pct}}% are applied to bring the loss to a fully reinstatable basis.</p>

<h2>6. Loss computation</h2>
<table class="totals">
  <tr><td>Subtotal (damaged-qty × rate)</td><td class="num">{{loss_sheet.subtotal_inr}}</td></tr>
  <tr><td>Add: Insurance @ {{loss_sheet.insurance_rate_pct}}%</td><td class="num">{{loss_sheet.insurance_total_inr}}</td></tr>
  <tr><td>Pre-GST total</td><td class="num">{{loss_sheet.pre_gst_inr}}</td></tr>
  <tr><td>Add: GST @ {{loss_sheet.gst_rate_pct}}%</td><td class="num">{{loss_sheet.gst_amount_inr}}</td></tr>
  <tr><td>Sub-total (after GST)</td><td class="num">{{loss_sheet.after_gst_inr}}</td></tr>
  <tr><td>Add: Handling @ {{loss_sheet.handling_rate_pct}}%</td><td class="num">{{loss_sheet.handling_amount_inr}}</td></tr>
  <tr><td>Less: Salvage</td><td class="num">{{loss_sheet.salvage_inr}}</td></tr>
  <tr><td>Net Loss</td><td class="num">{{loss_sheet.net_loss_inr}}</td></tr>
  <tr><td>Less: Policy excess</td><td class="num">{{loss_sheet.excess_inr}}</td></tr>
  <tr class="grand"><td>Net Adjusted Loss</td><td class="num">{{loss_sheet.net_adjusted_loss_inr}}</td></tr>
</table>

<h2>7. Liability under policy</h2>
<p><strong>Admissibility:</strong> {{ila.admissibility_label}}</p>
<p>{{ila.admissibility_reasoning}}</p>

<div class="signoff">
  <p><strong>Signed by:</strong></p>
  <p style="margin-top: 22px;"><strong>{{signer.name}}</strong><br/>IRDAI Licence: {{signer.license}}<br/>For Nathani Insurance Surveyors and Loss Assessors Pvt. Ltd.<br/><span style="font-size: 9pt; color: #64748b;">Date: {{date_today}}</span></p>
</div>

<div class="footer">Generated by NISLA Portal · Surveyor reference {{claim.ref_number}}</div>

<div class="annex">
  <h2 style="margin-top: 0;">Annexure-A — Itemised Cargo Damage</h2>
  {{loss_items_table}}
</div>

</body></html>'),

('Acuere', 'Marine Cargo', 'Default', 1,
'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><title>Marine Cargo FSR — {{claim.ref_number}}</title>
<style>@page { size: A4; margin: 16mm; } body { font-family: ''Times New Roman'', Times, serif; font-size: 11pt; line-height: 1.45; }
.letterhead { text-align: center; border-bottom: 2px solid #1a7ab5; padding-bottom: 8px; margin-bottom: 12px; }
.letterhead h1 { margin: 0; font-size: 14pt; color: #1a7ab5; }
.letterhead .sub { font-size: 9pt; color: #475569; margin-top: 2px; }
.doc-title { text-align: center; font-size: 13pt; font-weight: 700; margin: 14px 0 4px; color: #1a7ab5; }
h2 { font-size: 11pt; color: #1a7ab5; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; margin: 14px 0 6px; text-transform: uppercase; }
table.kv { width: 100%; border-collapse: collapse; margin: 6px 0 12px; }
table.kv td { padding: 4px 6px; vertical-align: top; border: 1px solid #e2e8f0; font-size: 10pt; }
table.kv td.lbl { width: 4%; font-weight: 600; color: #475569; text-align: center; }
table.kv td.k { width: 24%; font-weight: 600; color: #475569; }
table.totals { width: 70%; margin: 12px 0 12px auto; border-collapse: collapse; font-size: 11pt; }
table.totals td { padding: 4px 8px; }
table.totals tr.grand td { font-weight: 700; border-top: 2px solid #1a7ab5; padding-top: 8px; }
table.loss { width: 100%; border-collapse: collapse; font-size: 9pt; }
table.loss th, table.loss td { border: 1px solid #cbd5e1; padding: 3px 5px; }
table.loss th { background: #f1f5f9; }
table.loss td.num { text-align: right; }
.annex { page-break-before: always; }
.signoff { margin-top: 30px; padding-top: 12px; border-top: 1px dashed #94a3b8; }
.footer { margin-top: 24px; font-size: 8pt; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 6px; }
</style></head><body>
<div class="letterhead"><h1>ACUERE SURVEYORS</h1><div class="sub">IRDA Licence: IRDAI/IND/SLA-85225</div></div>
<div class="doc-title">MARINE CARGO — FINAL SURVEY REPORT</div>
<h2>1. Claim details</h2>
<table class="kv">
<tr><td class="lbl">a</td><td class="k">Reference</td><td>{{claim.ref_number}}</td></tr>
<tr><td class="lbl">b</td><td class="k">Insurer</td><td>{{claim.insurer_name}}</td></tr>
<tr><td class="lbl">c</td><td class="k">Insured</td><td>{{claim.insured_name}}</td></tr>
<tr><td class="lbl">d</td><td class="k">Policy</td><td>{{claim.policy_number}}</td></tr>
<tr><td class="lbl">e</td><td class="k">Sum insured</td><td>{{loss_sheet.sum_insured_inr}}</td></tr>
<tr><td class="lbl">f</td><td class="k">Date of loss</td><td>{{claim.date_loss}}</td></tr>
<tr><td class="lbl">g</td><td class="k">Loss location</td><td>{{claim.loss_location}}</td></tr>
</table>
<h2>2. Cause of loss</h2><p>{{ila.preliminary_view}}</p>
<h2>3. Loss computation</h2>
<table class="totals">
<tr><td>Subtotal</td><td class="num">{{loss_sheet.subtotal_inr}}</td></tr>
<tr><td>Add: Insurance @ {{loss_sheet.insurance_rate_pct}}%</td><td class="num">{{loss_sheet.insurance_total_inr}}</td></tr>
<tr><td>Pre-GST</td><td class="num">{{loss_sheet.pre_gst_inr}}</td></tr>
<tr><td>Add: GST @ {{loss_sheet.gst_rate_pct}}%</td><td class="num">{{loss_sheet.gst_amount_inr}}</td></tr>
<tr><td>Sub-total</td><td class="num">{{loss_sheet.after_gst_inr}}</td></tr>
<tr><td>Add: Handling @ {{loss_sheet.handling_rate_pct}}%</td><td class="num">{{loss_sheet.handling_amount_inr}}</td></tr>
<tr><td>Less: Salvage</td><td class="num">{{loss_sheet.salvage_inr}}</td></tr>
<tr><td>Net Loss</td><td class="num">{{loss_sheet.net_loss_inr}}</td></tr>
<tr><td>Less: Excess</td><td class="num">{{loss_sheet.excess_inr}}</td></tr>
<tr class="grand"><td>Net Adjusted Loss</td><td class="num">{{loss_sheet.net_adjusted_loss_inr}}</td></tr>
</table>
<h2>4. Liability</h2><p><strong>Admissibility:</strong> {{ila.admissibility_label}}</p><p>{{ila.admissibility_reasoning}}</p>
<div class="signoff"><p><strong>Signed by:</strong></p><p style="margin-top: 22px;"><strong>{{signer.name}}</strong><br/>IRDAI Licence: {{signer.license}}<br/>For Acuere Surveyors</p></div>
<div class="footer">Generated by NISLA Portal · Ref {{claim.ref_number}}</div>
<div class="annex"><h2 style="margin-top: 0;">Annexure-A — Itemised Cargo Damage</h2>{{loss_items_table}}</div>
</body></html>')
ON CONFLICT (company, lob, template_name, version) DO NOTHING;

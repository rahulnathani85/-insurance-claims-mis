// =============================================================================
// lib/fsr/narrativeFields.js
// =============================================================================
// LOB-aware list of {{narrative.*}} placeholders that surveyors fill in via
// the narrative editor (`components/fsr/NarrativeEditor.jsx`).
//
// Each entry has:
//   key       — the placeholder name; saved into claim_fsr_drafts.narrative_jsonb
//   label     — human-readable label for the form
//   type      — 'text' | 'textarea' | 'date' (default 'text')
//   placeholder — example text shown in the input
//   help      — one-line guidance shown below the input (optional)
//   wide      — true to make the input span both columns of the 2-col grid
//
// Sections are rendered as collapsible groups. The first section starts open;
// surveyors can collapse anything they've finished to keep the page short.
// =============================================================================

const MARINE_FIELDS = [
  {
    title: 'Survey header',
    fields: [
      { key: 'instructions_received_from', label: 'Instructions received from', placeholder: 'Mumbai Regional Office of The New India Assurance Co. Ltd.', wide: true },
      { key: 'insurer_office_address',     label: 'Insurer office address',      type: 'textarea', placeholder: 'New India Centre, 3rd Floor, 17 Cooperage Road, Mumbai – 400001', wide: true },
      { key: 'dates_of_survey',            label: 'Date(s) of survey',           placeholder: '07/04/2026 and on subsequent dates' },
      { key: 'place_of_survey',            label: 'Place of survey',             type: 'textarea', placeholder: 'M/s. New Life Assembly of God, Anna Salai, Little Mount, Chennai - 600015', wide: true },
      { key: 'person_contacted',           label: 'Person contacted',            placeholder: 'Mr. Melbin Jose' },
    ],
  },
  {
    title: 'Consignment particulars',
    fields: [
      { key: 'lr_no',          label: 'LR / Shipment No.',           placeholder: '3176' },
      { key: 'lr_date',        label: 'LR / Shipment date',          placeholder: '28/03/2026' },
      { key: 'vehicle_no',     label: 'Vehicle No.',                 placeholder: 'TN-90-C-8869' },
      { key: 'carrier',        label: 'Carrier',                     type: 'textarea', placeholder: 'M/s Shree Prasanna Roadways, Trajpar, Morbi, Gujarat - 363642', wide: true },
      { key: 'consignor',      label: 'Consignor',                   type: 'textarea', placeholder: 'M/s Simero Vitrified Pvt Ltd, Morbi, Gujarat 363642', wide: true },
      { key: 'consignee',      label: 'Consignee',                   type: 'textarea', placeholder: 'M/s. New Life Assembly, Chennai - 600015', wide: true },
      { key: 'goods_description', label: 'Description of goods',      placeholder: '340 Boxes of Tiles' },
      { key: 'invoice_details', label: 'Invoice details',            type: 'textarea', placeholder: 'S/2025-26/23184 dated 28/03/2026, Invoice Value: Rs 9,18,378/-', wide: true },
      { key: 'total_consignment_value_inr', label: 'Total consignment value', placeholder: 'Rs. 10,10,216/-' },
    ],
  },
  {
    title: 'Policy / coverage particulars',
    fields: [
      { key: 'basis_of_valuation',          label: 'Basis of valuation',  placeholder: 'CIF + 10%' },
      { key: 'policy_packing_description',  label: 'Policy packing description', placeholder: 'Standard and Customary' },
      { key: 'transport_mode',              label: 'Transport mode',      placeholder: 'Rail / Road / Air' },
      { key: 'commodity_description',       label: 'Commodity description', type: 'textarea', placeholder: 'All types of ceramic tiles, vitrified tiles ...', wide: true },
      { key: 'journey_details',             label: 'Journey details',     type: 'textarea', placeholder: 'From anywhere in India to anywhere in India', wide: true },
      { key: 'policy_excess_text',          label: 'Policy excess (full text)', placeholder: '0.5% on consignment value subject to minimum Rs. 5,000/-' },
      { key: 'risks_covered',               label: 'Risks covered',       placeholder: 'ITC-A, SRCC' },
    ],
  },
  {
    title: 'Sequence + situation of loss',
    fields: [
      { key: 'date_of_booking',  label: 'Date of booking',  placeholder: '28/03/2026 from Morbi' },
      { key: 'date_of_arrival',  label: 'Date of arrival',  placeholder: '04/04/2026 at Chennai' },
      { key: 'transit',          label: 'Transit (route)',  placeholder: 'From Morbi (Gujarat) to Chennai (Tamil Nadu)' },
      { key: 'packing_description', label: 'Actual packing observed', type: 'textarea', placeholder: 'The consignment was packed in cardboard cartons which was standard and customary as per industrial practice.', wide: true },
      { key: 'situation_of_loss', label: 'Situation of loss', type: 'textarea', placeholder: 'The consignee\'s representative reported that consignment containing 340 boxes of tiles was sent from Morbi on 28/03/2026 ...', wide: true, help: 'The narrative the consignee reported during your survey.' },
    ],
  },
  {
    title: 'Observations + assessment basis',
    fields: [
      { key: 'observations',  label: 'Our observations / findings', type: 'textarea', placeholder: 'During our survey, we conducted discreet enquiry about the incident from the consignee ...', wide: true, help: 'Multi-paragraph is fine. Surveyor-style language.' },
      { key: 'gst_treatment', label: 'GST treatment',                placeholder: 'GST component allowed subject to reversal proof.' },
      { key: 'salvage_basis', label: 'Salvage basis',                type: 'textarea', placeholder: 'Since the material was destroyed in our presence, we have not deducted any salvage.', wide: true },
    ],
  },
  {
    title: 'Insured’s claim',
    fields: [
      { key: 'insured_claim_amount_inr',   label: 'Amount claimed (in figures)', placeholder: 'Rs. 28,000/-' },
      { key: 'insured_claim_amount_words', label: 'Amount claimed (in words)',   placeholder: 'Rupees Twenty Eight Thousand Only', wide: true },
    ],
  },
  {
    title: 'Consent + recovery rights',
    fields: [
      { key: 'consent_of_insured',  label: 'Consent of insured',         type: 'textarea', placeholder: 'Insured has agreed with the assessment done by us and has given the consent for the same.', wide: true },
      { key: 'lr_remarks',          label: 'Any remarks on LR',          placeholder: 'No adverse remark on LR.' },
      { key: 'damage_certificate',  label: 'Damage certificate from carrier', placeholder: 'Yes, provided dated 24/02/2026' },
      { key: 'monetary_claim_status', label: 'Monetary claim lodged on carrier', placeholder: 'Insured advised to lodge claim by Regd. A/D' },
      { key: 'probable_cause',      label: 'Probable cause of damage',   placeholder: 'During transit due to jerks and jolts' },
    ],
  },
];

const EW_FIELDS = [
  {
    title: 'Survey header',
    fields: [
      { key: 'instructions_received_from', label: 'Instructions received from', placeholder: 'Claims Hub of Chennai Office of The Oriental Insurance Co. Ltd.', wide: true },
      { key: 'insurer_office_address',     label: 'Insurer office address',      type: 'textarea', placeholder: '411200-DO.-2 Chennai, UIL Building, 4th floor, Chennai - 600108', wide: true },
      { key: 'insured_address',            label: 'Insured address',             type: 'textarea', placeholder: '1st Floor, Old No. 38, New No. 44, Veerabadran Street, Nungambakkam, Chennai - 600034', wide: true },
      { key: 'person_contacted',           label: 'Person contacted',            placeholder: 'Mr. Prasad Jadhav (Service Centre)' },
      { key: 'service_centre',             label: 'Service centre',              type: 'textarea', placeholder: 'M/s Krishna Auto Link, 552 B/523 B, Near Pune Banglore Highway, Wadhe, Satara', wide: true },
    ],
  },
  {
    title: 'Vehicle particulars',
    fields: [
      { key: 'customer_name',          label: 'Name of customer',         placeholder: 'Mr. Sachin' },
      { key: 'registration_no',        label: 'Registration No.',         placeholder: 'MH-12-UJ-4988' },
      { key: 'date_of_registration',   label: 'Date of registration',     placeholder: '16/07/2022' },
      { key: 'vehicle_make',           label: 'Make',                     placeholder: 'Jeep' },
      { key: 'vehicle_model',          label: 'Model / Fuel type',        placeholder: 'Compass MCA' },
      { key: 'vin',                    label: 'VIN / Chassis No.',        placeholder: 'MCANJREYXNFA94848' },
      { key: 'engine_no',              label: 'Engine No.',               placeholder: '4186889' },
      { key: 'odometer',               label: 'Odometer reading',         placeholder: '44,331 km' },
    ],
  },
  {
    title: 'Plan + certificate',
    fields: [
      { key: 'plan_name',             label: 'Plan name',                  placeholder: 'Jeep Extended Warranty' },
      { key: 'certificate_no',        label: 'Certificate No.',            placeholder: 'JEW4020' },
      { key: 'certificate_validity',  label: 'Certificate validity',       placeholder: 'Valid up to 16/07/2025 to 16/07/2027 or 150,000 Kms', wide: true },
      { key: 'product_description',   label: 'Product description',        type: 'textarea', placeholder: 'Jeep Extended Warranty (provides additional vehicle warranty after expiry of manufacturer\'s warranty, i.e. 2 years or 100,000 kms whichever is earlier)', wide: true },
      { key: 'terms_and_conditions',  label: 'Terms & conditions',         placeholder: 'As per Jeep Extended Warranty' },
    ],
  },
  {
    title: 'Survey findings',
    fields: [
      { key: 'customer_complaint',  label: 'Customer complaint',         type: 'textarea', placeholder: 'PLGM not working — back door dicky not opening on 25-02-2026.', wide: true },
      { key: 'observations',        label: 'Our survey / inspection / findings', type: 'textarea', placeholder: 'During our survey the dealer dismantled the vehicle and informed that Elect Motor Power Liftgate etc items were defective and needed to be replaced ...', wide: true, help: 'Multi-paragraph is fine.' },
    ],
  },
  {
    title: 'Tax invoice + assessment',
    fields: [
      { key: 'tax_invoice_no',         label: 'Tax invoice No.',          placeholder: 'EW07101422600030' },
      { key: 'tax_invoice_date',       label: 'Tax invoice date',         placeholder: '06/03/2026' },
      { key: 'tax_invoice_amount_inr', label: 'Tax invoice amount',       placeholder: 'Rs. 70,385/-' },
      { key: 'assessment_basis',       label: 'Assessment basis',         type: 'textarea', placeholder: 'We have assessed the loss based on physical observation and documents submitted ...', wide: true },
    ],
  },
];

const FIRE_FIELDS = [
  {
    title: 'About insured',
    fields: [
      { key: 'about_insured', label: 'About the insured (background)', type: 'textarea', placeholder: 'M/s ... is engaged in the manufacturing of ... at the captioned location since ...', wide: true, help: 'A short paragraph: business, location, scale of operations.' },
    ],
  },
  {
    title: 'Incident',
    fields: [
      { key: 'incident_quote', label: 'Incident as briefed by insured (verbatim)', type: 'textarea', placeholder: 'On 29/04/2026 at around 02:30 hrs, the night security guard noticed smoke from ...', wide: true, help: 'Reproduced verbatim — the report appends a disclaimer that grammar is preserved as-is.' },
      { key: 'police_gd',     label: 'Police GD / panchnama',                     type: 'textarea', placeholder: 'A General Diary entry was registered at Goregaon (E) Police Station vide GD No. ...', wide: true },
      { key: 'fire_brigade',  label: 'Fire brigade report',                       type: 'textarea', placeholder: 'The Mumbai Fire Brigade attended the call at ... and the fire was brought under control by ...', wide: true },
    ],
  },
  {
    title: 'Observations',
    fields: [
      { key: 'observations', label: 'Our observations / findings', type: 'textarea', placeholder: 'During our visit on ... we observed extensive smoke staining on the eastern wall ...', wide: true, help: 'Walk through what you saw + measured. Multi-paragraph fine.' },
    ],
  },
];

const ILA_EXTRAS = [
  {
    title: 'ILA-only sections (preliminary report)',
    fields: [
      { key: 'preliminary_findings', label: 'Preliminary findings',    type: 'textarea', placeholder: 'Initial inspection on ... revealed ...', wide: true, help: 'What you saw on first visit. The full FSR has more detail; the ILA captures the first-look summary.' },
      { key: 'documents_pending',    label: 'Documents pending from insured', type: 'textarea', placeholder: 'Final repair invoice, statutory body report, photographs of dismantled parts.', wide: true },
      { key: 'next_steps',           label: 'Next steps',               type: 'textarea', placeholder: 'Re-inspect once the dealer has completed the repair and produced the tax invoice. Final assessment to follow.', wide: true },
    ],
  },
];

// -----------------------------------------------------------------------------
// fieldsForLob — main entry. Returns an array of section objects.
// -----------------------------------------------------------------------------
// templateName='ILA' adds the ILA-only sections. Anything else gets just the
// LOB-specific sections.
// -----------------------------------------------------------------------------
export function fieldsForLob(lob, templateName = 'Production') {
  const base =
    lob === 'Marine Cargo' || lob === 'Marine Hull' ? MARINE_FIELDS :
    lob === 'Extended Warranty'                     ? EW_FIELDS :
    lob === 'Fire'                                  ? FIRE_FIELDS :
    [];
  if (templateName === 'ILA') return [...base, ...ILA_EXTRAS];
  return base;
}

// Convenience: flat list of every key (used for completeness counting)
export function allKeysFor(lob, templateName) {
  return fieldsForLob(lob, templateName).flatMap((s) => s.fields.map((f) => f.key));
}

// Map a placeholder path back to a friendly label, used by the
// missing-placeholders chip list. e.g. 'narrative.situation_of_loss' →
// 'Situation of loss'. Unknown paths fall back to the bare key.
export function labelForPlaceholder(path, lob) {
  if (typeof path !== 'string') return path;
  if (!path.startsWith('narrative.')) return path;
  const key = path.slice('narrative.'.length);
  for (const lobName of ['Marine Cargo', 'Extended Warranty', 'Fire']) {
    const found = fieldsForLob(lobName, 'ILA').flatMap((s) => s.fields).find((f) => f.key === key);
    if (found) return found.label;
  }
  return key;
}

export const __FIELD_GROUPS__ = { MARINE_FIELDS, EW_FIELDS, FIRE_FIELDS, ILA_EXTRAS };

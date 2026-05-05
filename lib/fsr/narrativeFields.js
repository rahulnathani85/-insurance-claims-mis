// =============================================================================
// lib/fsr/narrativeFields.js
// =============================================================================
// LOB-aware list of {{narrative.*}} placeholders that surveyors fill in via
// the narrative editor (`components/fsr/NarrativeEditor.jsx`).
//
// Each entry has:
//   key       — the placeholder name; saved into claim_fsr_drafts.narrative_jsonb
//   label     — human-readable label for the form
//   type      — 'text' | 'textarea' | 'date' | 'array' (default 'text')
//   placeholder — example text shown in the input
//   help      — one-line guidance shown below the input (optional)
//   wide      — true to make the input span both columns of the 2-col grid
//
// Array fields:
//   type='array' renders a small editable table with add/delete row buttons.
//   The shape of each row is declared by `itemSchema: [{key,label,type,colWidth}]`.
//   The editor stores rows as an array of objects in narrative_jsonb[<key>]
//   and the server-side renderer (lib/fsr/render.js) turns them into the
//   pre-rendered HTML tables exposed via {{narrative.<derivedKey>_table}}.
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

// -----------------------------------------------------------------------------
// MARINE_CARGO_ULTRATECH_FIELDS — Ultratech Marine Cargo (template_name =
// 'Ultratech_Marine_Cargo_v1'). Drives the Phase 1b form for that template.
// Field keys map 1:1 to {{narrative.*}} placeholders in the template body
// inserted by migration 20260504173522.
// -----------------------------------------------------------------------------
const MARINE_CARGO_ULTRATECH_FIELDS = [
  {
    title: 'Survey header',
    fields: [
      { key: 'insurer_office_address',     label: 'Insurer office address',      type: 'textarea', placeholder: 'Tata AIG General Insurance Co. Ltd., 28 Dr Ernest Borges Road, Mumbai – 400012', wide: true },
      { key: 'dates_of_survey',            label: 'Date(s) of survey',           placeholder: '16/04/2026 & 18/04/2026 and subsequent dates' },
      { key: 'place_of_survey',            label: 'Place of survey',             type: 'textarea', placeholder: 'Vill – Mirjapur, Bukhara to Faridpur Road, Bareilly – 243004', wide: true },
      { key: 'person_contacted',           label: 'Person contacted (consignee rep.)', placeholder: 'Mr. Vinod Phatak' },
      { key: 'final_doc_submission_date',  label: 'Final document submission date', placeholder: '02/05/2026' },
      { key: 'consent_date',               label: 'Consent date',                placeholder: '04/05/2026' },
      { key: 'delay_reason',               label: 'Reason for any delay',        placeholder: 'NA' },
    ],
  },
  {
    title: 'Consignor + Consignee',
    fields: [
      { key: 'consignor_name',     label: 'Consignor name',          placeholder: 'M/s Ultratech Cement Ltd.' },
      { key: 'consignor_address',  label: 'Consignor address',       type: 'textarea', placeholder: 'Bara Cement Works, PO Lohgara, Tehsil Bara, Allahabad, UP – 212107', wide: true },
      { key: 'consignee_name',     label: 'Consignee name',          placeholder: 'M/s Ultratech Cement Ltd.' },
      { key: 'consignee_address',  label: 'Consignee address',       type: 'textarea', placeholder: 'UTCL Bareilly RH, Railway Siding, Bukara to Fareedpur Road, Bareilly', wide: true },
    ],
  },
  {
    title: 'Consignment particulars',
    fields: [
      { key: 'type_of_packing',          label: 'Type of packing',                placeholder: 'HDPE / PP bags' },
      { key: 'cargo_type',               label: 'Cargo type / product',           placeholder: 'Cement' },
      { key: 'consignment_weight_bags',  label: 'Total consignment (bags)',       placeholder: '40858' },
      { key: 'consignment_weight_mt',    label: 'Total consignment (MT)',         placeholder: '2042.900' },
      { key: 'mode_of_transit',          label: 'Mode of transit',                placeholder: 'Rail' },
      { key: 'transit_from',             label: 'Transit from (location)',        placeholder: 'Prayagraj (UCLB)' },
      { key: 'transit_to',               label: 'Transit to (location)',          placeholder: 'Bareilly (BRYC)' },
      { key: 'rr_no',                    label: 'RR / LR number',                 placeholder: '262002250' },
      { key: 'rr_date',                  label: 'RR / LR date',                   placeholder: '06/04/2026' },
      { key: 'date_of_dispatch',         label: 'Date of dispatch',               placeholder: '06/04/2026' },
      { key: 'date_of_arrival',          label: 'Date of arrival',                placeholder: '08/04/2026' },
      { key: 'place_of_arrival',         label: 'Place of arrival',               placeholder: 'Bareilly' },
      { key: 'type_of_load',             label: 'Type of load',                   placeholder: 'Full Load' },
      { key: 'invoice_details_block',    label: 'Invoice details (multiple invoices, one per line)', type: 'textarea', placeholder: '9858084683 dated 06/04/2026 — Rs. 73,80,157.48\n9858084682 dated 06/04/2026 — Rs. 18,37,388.21', wide: true, help: 'Free-form. Listed verbatim under "Invoice(s)" in the FSR.' },
      { key: 'total_consignment_value_inr_ult', label: 'Total consignment value (₹)', placeholder: 'Rs. 92,17,545.69' },
    ],
  },
  {
    title: 'Policy particulars',
    fields: [
      { key: 'policy_type_label',         label: 'Policy type label',             placeholder: 'Marine Cargo Open Policy' },
      { key: 'interest_insured',          label: 'Interest insured (full text)',  type: 'textarea', placeholder: 'Building products such as Fixoblock (Jointing Mortar), Power Grout, Readiplast, Seal & Dry, Stucco, … and any other building & construction-related products including packing materials. Consignment in bulk or break bulk or containerised.', wide: true },
      { key: 'policy_packing_details',    label: 'Policy packing details',        placeholder: 'Standard and Customary' },
      { key: 'policy_conveyance',         label: 'Policy conveyance clause',      placeholder: 'Domestic: by Rail, by Road, by Air, by Sea, by courier, by registered post parcel, by inland waterways, by inland coastal, by others' },
      { key: 'policy_voyage',             label: 'Policy voyage clause',          placeholder: 'From anywhere in India to anywhere in India' },
      { key: 'policy_coverage_type',      label: 'Coverage type',                 placeholder: 'All Risk' },
      { key: 'policy_basis_of_valuation', label: 'Basis of valuation',            placeholder: 'Inland: CIF + 10% + Duty at actuals' },
      { key: 'policy_excess',             label: 'Policy excess',                 placeholder: 'Flat INR 10,000 for each & every claim' },
    ],
  },
  {
    title: 'Loss details',
    fields: [
      { key: 'type_of_loss',              label: 'Type of loss',                  placeholder: 'Partial Loss' },
      { key: 'cause_of_loss_short',       label: 'Cause of loss (short phrase)',  placeholder: 'Fresh / Rainwater Damage' },
      { key: 'nature_of_loss',            label: 'Nature of loss',                placeholder: 'Water damage' },
      { key: 'extent_of_loss',            label: 'Extent of loss',                placeholder: 'Partial Loss' },
      { key: 'catastrophic_event',        label: 'Catastrophic event? (Yes/No)',  placeholder: 'No' },
      { key: 'accident_loss',             label: 'Accident / transhipment loss? (Yes/No)', placeholder: 'No' },
      { key: 'import_leg_loss',           label: 'Import leg loss? (Yes/No)',     placeholder: 'No' },
      { key: 'inter_depot_movement',      label: 'Inter-depot movement? (Yes/No)', placeholder: 'Yes' },
      { key: 'loss_location_label',       label: 'Loss location (in-words)',      placeholder: 'Loss at railway siding' },
      { key: 'fir_status',                label: 'FIR / Police complaint status', placeholder: 'NA' },
      { key: 'carrier_name',              label: 'Carrier / transporter',         placeholder: 'Indian Railway' },
      { key: 'vehicle_present_at_visit',  label: 'Vehicle present at visit? (Yes/No)', placeholder: 'No' },
      { key: 'storage_condition',         label: 'Storage condition of cargo',    placeholder: 'Separate' },
      { key: 'cargo_segregated',          label: 'Cargo segregated? (Yes/No)',    placeholder: 'Yes' },
    ],
  },
  {
    title: 'Packing & incident',
    fields: [
      { key: 'packing_description',         label: 'Packing description',         type: 'textarea', placeholder: 'The cargo was packed in HDPE bags. The packing was standard & customary and as per industry standard. Packing was adequate.', wide: true },
      { key: 'packing_external_condition',  label: 'External condition of packing during survey', type: 'textarea', placeholder: 'Many bags were in wet and damaged condition.', wide: true },
      { key: 'incident_narrative',          label: 'Incident narrative (full prose)', type: 'textarea', placeholder: 'M/s. Ultratech Cement Ltd., Lucknow (UP) had dispatched a consignment of cement bags … Due to heavy rain on 08/04/2026, in evening & night hours, many cement bags got wet/set/damaged at the railway siding.', wide: true, help: 'Multi-paragraph fine. This is the long narrative under "Incident Details".' },
      { key: 'observation_narrative',       label: 'Our observations / findings (full prose)', type: 'textarea', placeholder: 'Acting upon instructions received for survey and loss assessment of the captioned loss, we immediately contacted the consignee’s representative … (multi-paragraph)', wide: true, help: 'Multi-paragraph fine. Surveyor-style language; this populates the "Our Observations / Findings" section.' },
    ],
  },
  {
    title: 'Damaged items breakdown',
    fields: [
      {
        key: 'damaged_items',
        label: 'Damaged items (one row per invoice / description)',
        type: 'array',
        wide: true,
        help: 'Renders both the Damaged Bags table and the Loss Summary table in the FSR. extent_pct is the %age allowance applied to the row.',
        itemSchema: [
          { key: 'invoice_no',            label: 'Invoice / STN No', type: 'text',   colWidth: 130 },
          { key: 'description',           label: 'Description',      type: 'text',   colWidth: 130 },
          { key: 'pack_size',             label: 'Pack Size',        type: 'text',   colWidth: 80  },
          { key: 'total_dispatched_bags', label: 'Total Bags',       type: 'number', colWidth: 90  },
          { key: 'total_dispatched_mt',   label: 'Total MT',         type: 'number', colWidth: 90  },
          { key: 'damaged_bags',          label: 'Damaged Bags',     type: 'number', colWidth: 90  },
          { key: 'damaged_mt',            label: 'Damaged MT',       type: 'number', colWidth: 90  },
          { key: 'extent_pct',            label: 'Extent %',         type: 'number', colWidth: 80  },
          { key: 'loss_allowed_bags',     label: 'Loss Allowed Bags', type: 'number', colWidth: 110 },
          { key: 'loss_allowed_mt',       label: 'Loss Allowed MT',  type: 'number', colWidth: 110 },
        ],
      },
    ],
  },
  {
    title: 'Assessment numbers',
    fields: [
      { key: 'rate_per_mt_inr',         label: 'Rate per MT (₹)',                placeholder: 'Rs. 4,479.61' },
      { key: 'freight_per_mt_inr',      label: 'Freight per MT (₹)',             placeholder: 'Rs. 1,070.21' },
      { key: 'treatment_of_tax_note',   label: 'Treatment of tax (note)',        type: 'textarea', placeholder: 'Since the insured is a contractor and can avail input tax credit, GST has not been considered.', wide: true },
      { key: 'salvage_amount_note',     label: 'Salvage (basis / amount note)',  type: 'textarea', placeholder: 'Loss considered on percentage basis; no salvage value applied.', wide: true },
      { key: 'salvage_pickup_date',     label: 'Salvage pickup date',            placeholder: 'NA' },
      { key: 'salvage_buyer',           label: 'Salvage buyer',                  placeholder: 'Retained by Consignee' },
      { key: 'insurer_team_salvage',    label: 'Insurer salvage team involved? (Yes/No)', placeholder: 'No' },
      { key: 'excess_amount_inr',       label: 'Excess amount (₹)',              placeholder: 'Rs. 10,000/-' },
      { key: 'gross_assessed_loss_inr', label: 'Gross assessed loss (₹)',        placeholder: 'Rs. 53,298.40' },
      { key: 'net_adjusted_loss_inr_ult', label: 'Net adjusted loss (₹)',        placeholder: 'Rs. 43,298/-' },
      { key: 'net_adjusted_loss_words_ult', label: 'Net adjusted loss (in words)', placeholder: 'Rupees Forty-Three Thousand Two Hundred and Ninety-Eight Only', wide: true },
      { key: 'average_pct_loss',        label: 'Average % of loss',              placeholder: '18%' },
    ],
  },
  {
    title: 'Consent + recommendation',
    fields: [
      { key: 'consent_of_insured',         label: 'Consent of insured',          type: 'textarea', placeholder: 'We had a detailed discussion with the insured regarding the assessment of the claim …', wide: true },
      { key: 'recommendation_text',        label: 'Recommendation text (closing line)', type: 'textarea', placeholder: 'We hereby recommend to the insurer to settle this claim by paying the assessed amount to the insured for their claim due to the captioned loss.', wide: true },
      { key: 'recommendation_amount_inr',  label: 'Recommendation amount (₹)',   placeholder: 'Rs. 43,298/-' },
      { key: 'recommendation_amount_words', label: 'Recommendation amount (in words)', placeholder: 'Rupees Forty-Three Thousand Two Hundred and Ninety-Eight Only', wide: true },
    ],
  },
];

const MARINE_HULL_FIELDS = [
  {
    title: 'Survey header',
    fields: [
      { key: 'instructions_received_from', label: 'Instructions received from', placeholder: 'MRO-3 of The New India Assurance Co. Ltd.', wide: true },
      { key: 'insurer_office_address',     label: 'Insurer office address',      type: 'textarea', placeholder: 'New India Centre, 17 Cooperage Road, Mumbai – 400001', wide: true },
      { key: 'dates_of_survey',            label: 'Date(s) of survey',           placeholder: '12/04/2026, 14/04/2026' },
      { key: 'place_of_survey',            label: 'Place of survey',             type: 'textarea', placeholder: 'M/s ABC Ship Repair, Dry Dock No. 2, JNPT, Mumbai', wide: true },
      { key: 'person_contacted',           label: 'Person contacted (Master / Owner)', placeholder: 'Capt. Rajesh Kumar, Master' },
    ],
  },
  {
    title: 'Vessel + voyage particulars',
    fields: [
      { key: 'vessel_name',                label: 'Vessel name',                 placeholder: 'M.V. Konark', wide: true },
      { key: 'vehicle_no',                 label: 'IMO / Reg. No.',              placeholder: 'IMO 9234567' },
      { key: 'transit',                    label: 'Voyage from / to',            placeholder: 'Mumbai to Chennai', wide: true },
      { key: 'risks_covered',              label: 'Policy clauses',              placeholder: 'Institute Time Clauses Hulls (1/10/83) ITC-Hulls', wide: true },
      { key: 'policy_excess_text',         label: 'Policy excess / deductible',  placeholder: '0.5% of agreed value, minimum Rs. 5,00,000/-' },
    ],
  },
  {
    title: 'Situation + observations',
    fields: [
      { key: 'situation_of_loss', label: 'Situation of loss', type: 'textarea', placeholder: 'On 04/04/2026 at 14:30 hrs, the vessel encountered heavy weather while transiting near ...', wide: true, help: 'What happened. Time, position, conditions.' },
      { key: 'observations',      label: 'Our observations / findings', type: 'textarea', placeholder: 'During our survey on dry dock, we observed extensive damage to the starboard hull plating between frames 25-30 ...', wide: true, help: 'Multi-paragraph fine. Surveyor-style technical language.' },
    ],
  },
  {
    title: 'Assessment basis',
    fields: [
      { key: 'gst_treatment',  label: 'GST treatment',          placeholder: 'GST not added — input GST is reclaimable for the operator.' },
      { key: 'salvage_basis',  label: 'Salvage basis',          type: 'textarea', placeholder: 'Salvaged steel plates valued at Rs. 1,50,000/- recovered from the damaged section.', wide: true },
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
// Template-name dispatch:
//   - 'Ultratech_Marine_Cargo_v1' (Marine Cargo) -> the Ultratech-specific
//     Phase 1b form. Lifecycle engine resolves to this for any
//     match_lob='Marine Cargo' + match_client='UltraTech' claim.
//   - 'ILA' (any LOB) -> appends the ILA-only sections to the base set.
//   - anything else -> the base LOB set.
// -----------------------------------------------------------------------------
export function fieldsForLob(lob, templateName = 'Production') {
  // Template-specific overrides take precedence over the generic LOB set.
  if (lob === 'Marine Cargo' && templateName === 'Ultratech_Marine_Cargo_v1') {
    return MARINE_CARGO_ULTRATECH_FIELDS;
  }
  const base =
    lob === 'Marine Hull'        ? MARINE_HULL_FIELDS :
    lob === 'Marine Cargo'       ? MARINE_FIELDS :
    lob === 'Extended Warranty'  ? EW_FIELDS :
    lob === 'Fire'               ? FIRE_FIELDS :
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
  // Walk every known field set so the chip text is right regardless of which
  // template was resolved. Order doesn't matter — keys are unique within a
  // section (and across sections within an LOB).
  const candidateGroups = [
    fieldsForLob('Marine Cargo', 'Ultratech_Marine_Cargo_v1'),
    fieldsForLob('Marine Cargo', 'ILA'),
    fieldsForLob('Marine Hull', 'ILA'),
    fieldsForLob('Extended Warranty', 'ILA'),
    fieldsForLob('Fire', 'ILA'),
  ];
  for (const group of candidateGroups) {
    const found = group.flatMap((s) => s.fields).find((f) => f.key === key);
    if (found) return found.label;
  }
  return key;
}

export const __FIELD_GROUPS__ = {
  MARINE_FIELDS,
  MARINE_CARGO_ULTRATECH_FIELDS,
  MARINE_HULL_FIELDS,
  EW_FIELDS,
  FIRE_FIELDS,
  ILA_EXTRAS,
};

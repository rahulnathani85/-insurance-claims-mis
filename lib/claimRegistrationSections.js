// =============================================================================
// lib/claimRegistrationSections.js
// =============================================================================
// Shared form schema for the registration form. Used by:
//   - app/claim-registration/[id]/page.js — the registration wizard
//   - components/ClaimDetailsEditor.jsx — the editable mirror on the
//     claim-detail page's Registration tab (so surveyors can fix any
//     unfilled field after registration without leaving the FSR flow).
//
// Field types:
//   text | email | tel | date | number | textarea | select | boolean
//   lob_subcategory  — special: dropdown driven by the chosen LOB
//
// Per-field options:
//   key        — column on the claims row (also serialised into PUT body)
//   label      — display label
//   type       — see above
//   mandatory  — red asterisk + (in registration mode) gate the Submit button
//   hint       — small grey help text below the input
//   options    — required for type='select'; first '' entry = blank state
//
// LOCKED_REGISTRATION_FIELDS are the columns the editor must NOT let surveyors
// change. Identity + audit fields. Everything else is editable.
// =============================================================================

import { IRDAI_LOBS } from './lobSubcategories.js';

export const SECTIONS = [
  {
    key: 'insurer',
    title: 'Insurer',
    // insurer_name is owned by InsurerBlock above the form (drives the
    // ThreeOfficePicker scope); the rest stay here as plain inputs.
    fields: [
      { key: 'insurer_branch',         label: 'Branch',         type: 'text' },
      { key: 'dealing_officer_name',   label: 'Dealing officer', type: 'text' },
      { key: 'dealing_officer_email',  label: 'Officer email',  type: 'email' },
      { key: 'dealing_officer_phone',  label: 'Officer phone',  type: 'tel' },
    ],
  },
  {
    key: 'policy',
    title: 'Policy',
    fields: [
      { key: 'policy_number',      label: 'Policy #',     type: 'text', mandatory: true },
      { key: 'policy_period_from', label: 'Period from',  type: 'date', mandatory: true },
      { key: 'policy_period_to',   label: 'Period to',    type: 'date', mandatory: true },
      { key: 'sum_insured',        label: 'Sum insured (₹)', type: 'number', mandatory: true },
      { key: 'policy_type',        label: 'Policy type',  type: 'text' },
    ],
  },
  {
    key: 'insured',
    title: 'Insured',
    fields: [
      { key: 'insured_name',          label: 'Insured name', type: 'text', mandatory: true },
      { key: 'insured_address',       label: 'Address',      type: 'textarea' },
      { key: 'insured_contact_phone', label: 'Phone',        type: 'tel' },
      { key: 'insured_contact_email', label: 'Email',        type: 'email' },
      { key: 'insured_gstin',         label: 'GSTIN',        type: 'text' },
    ],
  },
  {
    key: 'loss',
    title: 'Loss',
    fields: [
      { key: 'lob',                    label: 'LOB',                 type: 'select', mandatory: true, options: ['', ...IRDAI_LOBS] },
      { key: 'lob_subcategory',        label: 'Sub-category',        type: 'lob_subcategory' },
      { key: 'peril_type',             label: 'Peril',               type: 'text' },
      { key: 'cause_of_loss',          label: 'Cause of loss',       type: 'text', hint: 'e.g. short circuit, machinery breakdown, road accident' },
      { key: 'date_loss',              label: 'Date of loss',        type: 'date', mandatory: true },
      { key: 'date_of_intimation',     label: 'Date of intimation',  type: 'date', mandatory: true },
      { key: 'loss_location',          label: 'Loss location',       type: 'textarea', mandatory: true },
      { key: 'loss_location_pin',      label: 'PIN',                 type: 'text', mandatory: true },
      { key: 'loss_location_state',    label: 'State',               type: 'text' },
      { key: 'loss_location_district', label: 'District',            type: 'text' },
      { key: 'estimated_loss_amount',  label: 'Estimated loss (₹)',  type: 'number', hint: 'Same as the claim amount intimated by the insurer' },
      { key: 'gross_loss',             label: 'Gross loss (₹)',      type: 'number' },
    ],
  },
  {
    key: 'classification',
    title: 'Classification',
    fields: [
      { key: 'complexity_tier', label: 'Complexity tier', type: 'select', options: ['', 'small', 'standard', 'large', 'cat'] },
      { key: 'is_catastrophe',  label: 'Linked to a catastrophe event?', type: 'boolean' },
    ],
  },
  {
    key: 'fee',
    title: 'Fee',
    fields: [
      { key: 'fee_basis',  label: 'Fee basis',     type: 'select', options: ['', 'irdai_scale', 'special_agreement'] },
      { key: 'fee_amount', label: 'Fee amount (₹)', type: 'number' },
      { key: 'fee_notes',  label: 'Fee notes',     type: 'textarea' },
    ],
  },
  {
    key: 'remark',
    title: 'Notes',
    fields: [
      { key: 'remark', label: 'Internal remark', type: 'textarea' },
    ],
  },
];

// Identity + audit fields the editor must NOT allow editing post-registration.
// Displayed read-only at the top of the editor.
export const LOCKED_REGISTRATION_FIELDS = Object.freeze([
  'id',
  'ref_number',
  'created_at',
  'registered_at',
  'registered_by',
]);

// Convenience: flat list of every editable field key. Used by the editor to
// build the PUT body (server-side dual-write picks up only fields that
// changed; this list is the universe of allowed keys).
export function allEditableFieldKeys() {
  const out = ['insurer_name'];  // owned by InsurerBlock, not a SECTIONS entry
  // The 9 office FK + derived columns from the 3-office picker.
  for (const role of ['appointing', 'policy', 'fsr']) {
    out.push(`${role}_office_id`, `${role}_office_name`, `${role}_office_address`);
  }
  for (const sec of SECTIONS) {
    for (const f of sec.fields) out.push(f.key);
  }
  // Drop any locked field if it ever leaks in.
  return out.filter((k) => !LOCKED_REGISTRATION_FIELDS.includes(k));
}

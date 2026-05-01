// =============================================================================
// lib/fsr/fieldMap.js
// =============================================================================
// Canonical FSR-relevant field list per LOB. Ported from
// nisla-ai-pack/lib/cache/fieldMap.js (CommonJS → ES module).
//
// Single source of truth for which fields should be:
//   1. Extracted from the OCR-enriched JSON
//   2. Auto-filled in surveyor-portal forms
//   3. Considered for FSR-completeness scoring
//
// Keys are dot-paths into the AI-pack's nested claim shape (camelCase, marine /
// warranty blocks). For the portal's flat `claims` row shape, see the
// translation in extractFsrFields.js.
// =============================================================================

export const COMMON_FIELDS = [
  { path: 'claimNo',          label: 'Claim No.',          required: true,  editable: true  },
  { path: 'insurer',          label: 'Insurer',            required: true,  editable: true  },
  { path: 'insured',          label: 'Insured',            required: true,  editable: true  },
  { path: 'dateOfIntimation', label: 'Date of Intimation', required: true,  editable: true,  type: 'date' },
  { path: 'dateOfLoss',       label: 'Date of Loss',       required: true,  editable: true,  type: 'date' },
  { path: 'dateOfSurvey',     label: 'Date of Survey',     required: true,  editable: true,  type: 'date' },
  { path: 'placeOfLoss',      label: 'Place of Loss',      required: true,  editable: true  },
  { path: 'reportType',       label: 'Report Type',        required: true,  editable: true,  type: 'enum', options: ['INTERIM', 'FINAL'] },

  { path: 'policy.policyNo',   label: 'Policy No.',        required: true,  editable: true  },
  { path: 'policy.fromDate',   label: 'Policy From',       required: true,  editable: true,  type: 'date' },
  { path: 'policy.toDate',     label: 'Policy To',         required: true,  editable: true,  type: 'date' },
  { path: 'policy.sumInsured', label: 'Sum Insured',       required: true,  editable: true,  type: 'number' },
  { path: 'policy.currency',   label: 'Currency',          required: false, editable: true  },
  { path: 'policy.excess',     label: 'Excess',            required: false, editable: true,  type: 'number' },

  { path: 'surveyor.name',     label: 'Surveyor Name',     required: true,  editable: false },
  { path: 'surveyor.slaNo',    label: 'SLA License No.',   required: true,  editable: false },
  { path: 'surveyor.category', label: 'Surveyor Category', required: true,  editable: false, type: 'enum', options: ['A', 'B', 'C'] },
];

export const MARINE_FIELDS = [
  ...COMMON_FIELDS,

  { path: 'marine.policyType', label: 'Policy Type', required: true, editable: true,
    type: 'enum', options: ['SPA', 'OPEN_POLICY', 'OPEN_COVER', 'ANNUAL'] },
  { path: 'marine.iccClause',  label: 'ICC Clause',  required: true, editable: true,
    type: 'enum', options: ['A', 'B', 'C', 'ICC_AIR', 'INLAND'] },

  { path: 'marine.voyage.from',         label: 'Voyage From',      required: true,  editable: true },
  { path: 'marine.voyage.to',           label: 'Voyage To',        required: true,  editable: true },
  { path: 'marine.voyage.sailingDate',  label: 'Sailing Date',     required: true,  editable: true, type: 'date' },
  { path: 'marine.voyage.arrivalDate',  label: 'Arrival Date',     required: false, editable: true, type: 'date' },
  { path: 'marine.voyage.vesselName',   label: 'Vessel / Carrier', required: false, editable: true },
  { path: 'marine.voyage.blAwbNo',      label: 'BL / AWB No.',     required: false, editable: true },
  { path: 'marine.voyage.containerNo',  label: 'Container No.',    required: false, editable: true },

  { path: 'marine.cargo.description',     label: 'Cargo Description', required: true,  editable: true },
  { path: 'marine.cargo.packing',         label: 'Packing',           required: true,  editable: true },
  { path: 'marine.cargo.quantity',        label: 'Quantity',          required: true,  editable: true },
  { path: 'marine.cargo.invoiceNo',       label: 'Invoice No.',       required: false, editable: true },
  { path: 'marine.cargo.invoiceValue',    label: 'Invoice Value',     required: true,  editable: true, type: 'number' },
  { path: 'marine.cargo.invoiceCurrency', label: 'Invoice Currency',  required: false, editable: true },

  { path: 'marine.causeOfLoss',  label: 'Cause of Loss',  required: true, editable: true,  type: 'textarea' },
  { path: 'marine.natureOfLoss', label: 'Nature of Loss', required: true, editable: true,
    type: 'enum', options: ['SHORTAGE', 'DAMAGE', 'NON_DELIVERY', 'TPND', 'GA', 'TOTAL_LOSS'] },

  { path: 'computation.grossLoss',          label: 'Gross Loss',         required: true,  editable: true, type: 'number' },
  { path: 'computation.lessSalvage',        label: 'Less: Salvage',      required: false, editable: true, type: 'number' },
  { path: 'computation.lessDepreciation',   label: 'Less: Depreciation', required: false, editable: true, type: 'number' },
  { path: 'computation.lessUnderInsurance', label: 'Less: Under-Insurance', required: false, editable: true, type: 'number' },
  { path: 'computation.lessExcess',         label: 'Less: Excess',       required: false, editable: true, type: 'number' },
  { path: 'computation.netAdjustedLoss',    label: 'Net Adjusted Loss',  required: true,  editable: true, type: 'number' },
];

export const WARRANTY_FIELDS = [
  ...COMMON_FIELDS,

  { path: 'warranty.equipment.make',         label: 'Make',          required: true,  editable: true },
  { path: 'warranty.equipment.model',        label: 'Model',         required: true,  editable: true },
  { path: 'warranty.equipment.serialNo',     label: 'Serial No.',    required: true,  editable: true },
  { path: 'warranty.equipment.purchaseDate', label: 'Purchase Date', required: true,  editable: true, type: 'date' },
  { path: 'warranty.equipment.invoiceValue', label: 'Equipment Invoice Value', required: false, editable: true, type: 'number' },
  { path: 'warranty.equipment.category',     label: 'Equipment Category', required: false, editable: true },

  { path: 'warranty.manufacturerWarranty.fromDate', label: 'Mfg Warranty From', required: true, editable: true, type: 'date' },
  { path: 'warranty.manufacturerWarranty.toDate',   label: 'Mfg Warranty To',   required: true, editable: true, type: 'date' },

  { path: 'warranty.extendedWarranty.fromDate', label: 'EW From',   required: true, editable: true, type: 'date' },
  { path: 'warranty.extendedWarranty.toDate',   label: 'EW To',     required: true, editable: true, type: 'date' },
  { path: 'warranty.extendedWarranty.planType', label: 'Plan Type', required: true, editable: true,
    type: 'enum', options: ['COMPREHENSIVE', 'PARTS_ONLY', 'LABOUR_ONLY', 'BREAKDOWN'] },

  { path: 'warranty.failure.dateOfFailure', label: 'Date of Failure', required: true, editable: true, type: 'date' },
  { path: 'warranty.failure.symptom',       label: 'Symptom',         required: true, editable: true, type: 'textarea' },
  { path: 'warranty.failure.rootCause',     label: 'Root Cause',      required: true, editable: true, type: 'textarea' },
  { path: 'warranty.failure.partsAffected', label: 'Parts Affected',  required: true, editable: true, type: 'array' },

  { path: 'warranty.failure.preExistingDamage',  label: 'Pre-existing Damage',  required: false, editable: true, type: 'boolean' },
  { path: 'warranty.failure.wearAndTear',        label: 'Wear & Tear',          required: false, editable: true, type: 'boolean' },
  { path: 'warranty.failure.unauthorisedRepair', label: 'Unauthorised Repair',  required: false, editable: true, type: 'boolean' },
  { path: 'warranty.failure.misuse',             label: 'Misuse',               required: false, editable: true, type: 'boolean' },

  { path: 'warranty.repairOrReplace', label: 'Repair / Replace', required: true, editable: true,
    type: 'enum', options: ['REPAIR', 'REPLACE', 'BER'] },

  { path: 'computation.partsCost',        label: 'Parts Cost',         required: false, editable: true, type: 'number' },
  { path: 'computation.labourCost',       label: 'Labour Cost',        required: false, editable: true, type: 'number' },
  { path: 'computation.gst',              label: 'GST',                required: false, editable: true, type: 'number' },
  { path: 'computation.grossLoss',        label: 'Gross Loss',         required: true,  editable: true, type: 'number' },
  { path: 'computation.lessDepreciation', label: 'Less: Depreciation', required: false, editable: true, type: 'number' },
  { path: 'computation.lessSalvage',      label: 'Less: Salvage',      required: false, editable: true, type: 'number' },
  { path: 'computation.lessExcess',       label: 'Less: Excess',       required: false, editable: true, type: 'number' },
  { path: 'computation.netAdjustedLoss',  label: 'Net Adjusted Loss',  required: true,  editable: true, type: 'number' },
];

export const FIELD_MAPS = {
  MARINE:       MARINE_FIELDS,
  EXT_WARRANTY: WARRANTY_FIELDS,
};

export function fieldsFor(lob) {
  return FIELD_MAPS[lob] || [];
}

export function fieldPathsFor(lob) {
  return fieldsFor(lob).map((f) => f.path);
}

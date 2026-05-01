// =============================================================================
// lib/fsr/schemas.js
// =============================================================================
// JSON-shape schemas describing the canonical claim payload per LOB.
//
// Ported from nisla-ai-pack/lib/schemas.js (CommonJS → ES module). Used by:
//   - lib/fsr/validationRules.js   for business-rule validation
//   - lib/fsr/extractFsrFields.js  for slicing claim data to FSR-relevant fields
//   - lib/fsr/fieldMap.js          which mirrors these paths for the UI form
//
// These schemas describe the AI-pack's internal JSON shape (camelCase, nested
// `marine` / `warranty` blocks) which is *different* from the portal's flat
// `claims` row shape. We keep the AI-pack shape for compat with the
// validation rules; conversion is handled by extractFsrFields.
// =============================================================================

const commonClaimFields = {
  claimNo:          { type: 'string', minLength: 3 },
  insurer:          { type: 'string' },
  insured:          { type: 'string' },
  dateOfIntimation: { type: 'string', format: 'date' },
  dateOfLoss:       { type: 'string', format: 'date' },
  dateOfSurvey:     { type: 'string', format: 'date' },
  placeOfLoss:      { type: 'string' },
  reportType:       { type: 'string', enum: ['INTERIM', 'FINAL'] },
  policy: {
    type: 'object',
    required: ['policyNo', 'fromDate', 'toDate', 'sumInsured'],
    properties: {
      policyNo:   { type: 'string' },
      fromDate:   { type: 'string', format: 'date' },
      toDate:     { type: 'string', format: 'date' },
      sumInsured: { type: 'number', minimum: 0 },
      currency:   { type: 'string', default: 'INR' },
      excess:     { type: 'number', minimum: 0 },
    },
  },
  surveyor: {
    type: 'object',
    required: ['name', 'slaNo', 'category'],
    properties: {
      name:     { type: 'string' },
      slaNo:    { type: 'string' },
      category: { type: 'string', enum: ['A', 'B', 'C'] },
    },
  },
};

export const marineSchema = {
  type: 'object',
  required: [
    'claimNo', 'insurer', 'insured', 'dateOfIntimation', 'dateOfLoss',
    'policy', 'surveyor', 'reportType', 'marine', 'computation',
  ],
  properties: {
    ...commonClaimFields,
    marine: {
      type: 'object',
      required: ['policyType', 'voyage', 'cargo', 'iccClause', 'causeOfLoss'],
      properties: {
        policyType: { type: 'string', enum: ['SPA', 'OPEN_POLICY', 'OPEN_COVER', 'ANNUAL'] },
        iccClause:  { type: 'string', enum: ['A', 'B', 'C', 'ICC_AIR', 'INLAND'] },
        voyage: {
          type: 'object',
          required: ['from', 'to', 'sailingDate'],
          properties: {
            from:        { type: 'string' },
            to:          { type: 'string' },
            sailingDate: { type: 'string', format: 'date' },
            arrivalDate: { type: 'string', format: 'date' },
            vesselName:  { type: 'string' },
            blAwbNo:     { type: 'string' },
            containerNo: { type: 'string' },
          },
        },
        cargo: {
          type: 'object',
          required: ['description', 'packing', 'quantity', 'invoiceValue'],
          properties: {
            description:     { type: 'string' },
            packing:         { type: 'string' },
            quantity:        { type: 'string' },
            invoiceNo:       { type: 'string' },
            invoiceValue:    { type: 'number', minimum: 0 },
            invoiceCurrency: { type: 'string' },
          },
        },
        causeOfLoss:  { type: 'string' },
        natureOfLoss: { type: 'string', enum: ['SHORTAGE', 'DAMAGE', 'NON_DELIVERY', 'TPND', 'GA', 'TOTAL_LOSS'] },
      },
    },
    computation: {
      type: 'object',
      required: ['grossLoss', 'netAdjustedLoss'],
      properties: {
        grossLoss:          { type: 'number' },
        lessSalvage:        { type: 'number', default: 0 },
        lessDepreciation:   { type: 'number', default: 0 },
        lessExcess:         { type: 'number', default: 0 },
        lessUnderInsurance: { type: 'number', default: 0 },
        netAdjustedLoss:    { type: 'number' },
      },
    },
    annexures: { type: 'array', items: { type: 'object' } },
  },
};

export const extWarrantySchema = {
  type: 'object',
  required: [
    'claimNo', 'insurer', 'insured', 'dateOfIntimation', 'dateOfLoss',
    'policy', 'surveyor', 'reportType', 'warranty', 'computation',
  ],
  properties: {
    ...commonClaimFields,
    warranty: {
      type: 'object',
      required: ['equipment', 'manufacturerWarranty', 'extendedWarranty', 'failure'],
      properties: {
        equipment: {
          type: 'object',
          required: ['make', 'model', 'serialNo', 'purchaseDate'],
          properties: {
            make:         { type: 'string' },
            model:        { type: 'string' },
            serialNo:     { type: 'string' },
            purchaseDate: { type: 'string', format: 'date' },
            invoiceValue: { type: 'number', minimum: 0 },
            category:     { type: 'string' },
          },
        },
        manufacturerWarranty: {
          type: 'object',
          required: ['fromDate', 'toDate'],
          properties: {
            fromDate: { type: 'string', format: 'date' },
            toDate:   { type: 'string', format: 'date' },
          },
        },
        extendedWarranty: {
          type: 'object',
          required: ['fromDate', 'toDate', 'planType'],
          properties: {
            fromDate: { type: 'string', format: 'date' },
            toDate:   { type: 'string', format: 'date' },
            planType: { type: 'string', enum: ['COMPREHENSIVE', 'PARTS_ONLY', 'LABOUR_ONLY', 'BREAKDOWN'] },
          },
        },
        failure: {
          type: 'object',
          required: ['dateOfFailure', 'symptom', 'rootCause', 'partsAffected'],
          properties: {
            dateOfFailure:      { type: 'string', format: 'date' },
            symptom:            { type: 'string' },
            rootCause:          { type: 'string' },
            partsAffected:      { type: 'array', items: { type: 'string' } },
            preExistingDamage:  { type: 'boolean', default: false },
            wearAndTear:        { type: 'boolean', default: false },
            unauthorisedRepair: { type: 'boolean', default: false },
            misuse:             { type: 'boolean', default: false },
          },
        },
        repairOrReplace: { type: 'string', enum: ['REPAIR', 'REPLACE', 'BER'] },
      },
    },
    computation: {
      type: 'object',
      required: ['grossLoss', 'netAdjustedLoss'],
      properties: {
        partsCost:        { type: 'number', default: 0 },
        labourCost:       { type: 'number', default: 0 },
        gst:              { type: 'number', default: 0 },
        grossLoss:        { type: 'number' },
        lessDepreciation: { type: 'number', default: 0 },
        lessSalvage:      { type: 'number', default: 0 },
        lessExcess:       { type: 'number', default: 0 },
        netAdjustedLoss:  { type: 'number' },
      },
    },
    annexures: { type: 'array', items: { type: 'object' } },
  },
};

export function schemaForLob(lob) {
  return lob === 'MARINE' ? marineSchema
       : lob === 'EXT_WARRANTY' ? extWarrantySchema
       : null;
}

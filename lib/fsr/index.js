// =============================================================================
// lib/fsr/index.js
// =============================================================================
// Public surface for the FSR module.
// =============================================================================

// Render — template resolution + LOB-aware context builder
export {
  renderFsrHtml,
  buildContext,
  renderLossItemsTable,
  renderMarineLossItemsTable,
  underinsuranceParagraph,
  substitute,
  fmtINR,
  fmtNumber,
  fmtDate,
  escapeHtml,
  companyProfile,
  assertCssSafeColor,
} from './render.js';

// Draft loader + payload sanitiser
export {
  loadFsrContext,
  sanitiseDraftPayload,
  ALLOWED_STATUSES,
} from './draft.js';

// Number-to-words for FSR amount-in-words rendering
export { rupeesInWords, numberInWords } from './numberToWords.js';

// Validation (LOB business rules + minimal JSON-schema check)
export { validateClaim } from './validationRules.js';

// Schemas + LOB field map (used by validation, extraction, completeness UI)
export { marineSchema, extWarrantySchema, schemaForLob } from './schemas.js';
export {
  COMMON_FIELDS,
  MARINE_FIELDS,
  WARRANTY_FIELDS,
  FIELD_MAPS,
  fieldsFor,
  fieldPathsFor,
} from './fieldMap.js';

// Field extractor + flat/nested converters
export {
  extractFsrFields,
  applyFlatPatch,
  getByPath,
  setByPath,
  claimRowToPackShape,
} from './extractFsrFields.js';

// AI prompt builders + parsers (call via lib/aiClient.js)
export {
  buildDraftNarrativePrompt,
  parseNarrativeJson,
  DRAFT_NARRATIVE_SYSTEM_PROMPT,
} from './draftNarrativePrompt.js';

export {
  buildSectionDraftPrompt,
  parseSectionDraft,
  SECTION_DRAFT_SYSTEM_PROMPT,
} from './sectionDraftPrompt.js';

export {
  buildClaimChatPrompt,
  parseChatJson,
  CLAIM_CHAT_SYSTEM_PROMPT,
} from './chatPrompt.js';

export {
  buildPhotoClassifyPrompt,
  parsePhotoClassifyJson,
  categoriesForLob,
  MARINE_CATEGORIES,
  WARRANTY_CATEGORIES,
  FIRE_CATEGORIES,
} from './photoClassifyPrompt.js';

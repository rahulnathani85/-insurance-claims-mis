// =============================================================================
// lib/fsr/index.js
// =============================================================================
// Public surface for the FSR module.
// =============================================================================

export {
  renderFsrHtml,
  buildContext,
  renderLossItemsTable,
  underinsuranceParagraph,
  substitute,
  fmtINR,
  fmtNumber,
  fmtDate,
  escapeHtml,
} from './render.js';

export {
  loadFsrContext,
  sanitiseDraftPayload,
  ALLOWED_STATUSES,
} from './draft.js';

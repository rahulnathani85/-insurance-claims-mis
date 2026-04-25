// ============================================================
// lib/comms/extractors/index.js
// ------------------------------------------------------------
// Per-tag extractor registry. Keyed by workflow_tag enum value.
// Week 2 plumbs two; Week 4 fills in the remaining five.
// internal_admin has no extractor by design (empty schema).
//
// Adding a new tag's extractor is a one-line change here.
// ============================================================

import { extractIntimation } from './intimation';
import { extractSettlementAdvice } from './settlementAdvice';

export const EXTRACTORS = {
  intimation: extractIntimation,
  settlement_advice: extractSettlementAdvice,
  // Week 4 will add:
  //   surveyor_photos:    extractSurveyorPhotos,
  //   site_visit_report:  extractSiteVisitReport,
  //   insurer_query:      extractInsurerQuery,
  //   client_followup:    extractClientFollowup,
  //   policy_doc:         extractPolicyDoc,
  // (internal_admin has no extractor; tag_definitions.extraction_schema = {})
};

// Returns the extractor's result `{ data, errors, isValid }` or null
// if no extractor is registered for the tag.
export function extractFor(tag, raw) {
  const fn = EXTRACTORS[tag];
  if (!fn) return null;
  return fn(raw);
}

export function hasExtractorFor(tag) {
  return Object.prototype.hasOwnProperty.call(EXTRACTORS, tag);
}

// =============================================================================
// lib/fsr/photoClassifyPrompt.js
// =============================================================================
// AI vision prompt for classifying surveyor-uploaded site photographs.
// Lifted from nisla-ai-pack/supabase/functions/classify-photos/index.ts —
// system-prompt builder + the LOB-specific category lists.
//
// Output is a JSON array of one classification object per image. Each
// classification has:
//   {
//     category: <one of MARINE_CATEGORIES or WARRANTY_CATEGORIES>,
//     tags: ['snake_case', ...],         // 3-6 short keywords
//     observations: '<one factual sentence>',
//     suggestedAnnexure: '<short title for the FSR annexure>',
//     confidence: 0..1,
//     flags: ['tampering_visible', 'pre_existing_damage', 'unclear_evidence', ...]
//   }
//
// This module is gated on the site-visit module landing first (CLAUDE.md
// §11 #3) — it expects a `site_visit_photos` table to exist for the
// uploads to be persisted. Until then it's a pure prompt builder + parser.
// =============================================================================

export const MARINE_CATEGORIES = [
  'DAMAGED_CARGO', 'CONTAINER_EXTERIOR', 'CONTAINER_INTERIOR', 'VESSEL',
  'PACKING', 'DOCUMENTS', 'SALVAGE', 'INGRESS_EVIDENCE', 'JOINT_SURVEY',
  'LABEL_MARKINGS', 'OTHER',
];

export const WARRANTY_CATEGORIES = [
  'DAMAGED_UNIT', 'SERIAL_PLATE', 'DEFECTIVE_PART', 'REPAIR_ESTIMATE',
  'DIAGNOSTIC_REPORT', 'AMBIENT_SETUP', 'DOCUMENTS', 'OTHER',
];

export const FIRE_CATEGORIES = [
  'FIRE_DAMAGE', 'STRUCTURE_EXTERIOR', 'STRUCTURE_INTERIOR', 'STOCK',
  'EQUIPMENT', 'ELECTRICAL_SOURCE', 'WATER_DAMAGE', 'SALVAGE',
  'POLICE_FIRE_BRIGADE_DOCS', 'INVOICES', 'OTHER',
];

const CATEGORIES_BY_LOB = {
  'Marine Cargo':       MARINE_CATEGORIES,
  'Marine Hull':        MARINE_CATEGORIES,
  'Extended Warranty':  WARRANTY_CATEGORIES,
  'Fire':               FIRE_CATEGORIES,
};

export function categoriesForLob(lob) {
  return CATEGORIES_BY_LOB[lob] || ['OTHER'];
}

// -----------------------------------------------------------------------------
// buildPhotoClassifyPrompt
// -----------------------------------------------------------------------------
// Returns a single `system` string to be sent with the user message that
// contains the image content blocks. Up to 8 images per call is the
// recommended batch size; the caller must enforce that.
// -----------------------------------------------------------------------------
export function buildPhotoClassifyPrompt({ lob, batchSize = 1 }) {
  const cats = categoriesForLob(lob);
  const lobLabel = lob || 'this claim';
  const system = `You are a senior insurance surveyor at NISLA / ACUERE classifying site photographs from a ${lobLabel} claim survey.

For each image you are shown, return ONE classification object. The user will provide N images in order; you return a JSON array with N objects in the same order.

Each object must have this exact shape:
{
  "category": "<one of: ${cats.join(' | ')}>",
  "tags": ["<3-6 short keywords describing what's visible, lowercase, snake_case>"],
  "observations": "<one factual sentence describing what is visible. No speculation. Surveyor-style language.>",
  "suggestedAnnexure": "<short title for the FSR annexure this photo belongs to, e.g. 'Photographs - Damaged Cargo' or 'Photographs - Serial Plate'>",
  "confidence": <0.0 - 1.0>,
  "flags": ["<any red flags: 'tampering_visible' | 'pre_existing_damage' | 'unclear_evidence' | 'date_mismatch' | etc., or empty array>"]
}

Rules:
- Be factual. Describe only what is clearly visible.
- If the image is blurry, dark, or ambiguous, set confidence < 0.6 and add 'unclear_evidence' to flags.
- If you spot something a surveyor should know (tampering, pre-existing damage, mismatched serial numbers, signs the damage isn't from the reported cause), add an appropriate flag.
- For DOCUMENTS, observations should mention what kind of document (invoice, BL, packing list, warranty card).
- Return ONLY the JSON array. No prose, no markdown fences.

Output: a JSON array of length ${batchSize}.`;

  return { system };
}

// -----------------------------------------------------------------------------
// parsePhotoClassifyJson — defensive parser
// -----------------------------------------------------------------------------
// Returns an array of N classification objects (matching the expected
// batch size). On parse failure, returns an array of N "unclassified"
// stubs so the caller never has to handle null.
// -----------------------------------------------------------------------------
export function parsePhotoClassifyJson(text, expectedCount = 1) {
  if (typeof text !== 'string') return stubArray(expectedCount);
  const stripped = text.replace(/```json|```/g, '').trim();
  try {
    const arr = JSON.parse(stripped);
    if (!Array.isArray(arr)) return stubArray(expectedCount);
    return arr.slice(0, expectedCount).map((c) => ({
      category:          typeof c.category === 'string' ? c.category : 'OTHER',
      tags:              Array.isArray(c.tags) ? c.tags : [],
      observations:      typeof c.observations === 'string' ? c.observations : '',
      suggestedAnnexure: typeof c.suggestedAnnexure === 'string' ? c.suggestedAnnexure : '',
      confidence:        clamp01(Number(c.confidence) || 0),
      flags:             Array.isArray(c.flags) ? c.flags : [],
    }));
  } catch {
    return stubArray(expectedCount);
  }
}

function stubArray(n) {
  return Array.from({ length: n }, () => ({
    category: 'OTHER',
    tags: [],
    observations: '',
    suggestedAnnexure: '',
    confidence: 0,
    flags: ['unclassified'],
  }));
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

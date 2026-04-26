// ============================================================
// lib/aiClients/providers/mistralOcr.js
// ------------------------------------------------------------
// Mistral OCR provider — primary OCR for the comms module.
//
// API docs: https://docs.mistral.ai/capabilities/ocr/
// Default model: mistral-ocr-2503 (the May-2025 GA build).
// Override via env OCR_MODEL or per-call `model` arg.
//
// Input modes:
//   - PDF / image bytes → encode as base64 data URL
//   - Public URL        → pass directly (cheaper, but not what we
//                          do since attachments live in private
//                          Supabase Storage)
//
// Pricing reference (USD):
//   - $1.00 per 1000 pages = $0.001 / page
// INR conversion via OCR_INR_PER_USD env (default 83).
//
// Returns markdown-format text concatenated across all pages.
// ============================================================

const DEFAULT_MODEL = 'mistral-ocr-2503';
const USD_PER_PAGE = 0.001;
const ENDPOINT = 'https://api.mistral.ai/v1/ocr';

export async function extract({ buffer, mimeType, filename, model }) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('MISTRAL_API_KEY not set');
  }
  if (!buffer || !buffer.length) {
    throw new Error('mistralOcr.extract: empty buffer');
  }

  const useModel = model || process.env.OCR_MODEL || DEFAULT_MODEL;

  // Mistral OCR accepts a document_url that can be a data URL.
  const b64 = Buffer.from(buffer).toString('base64');
  const dataUrl = `data:${mimeType || 'application/pdf'};base64,${b64}`;

  const isImage = mimeType && mimeType.startsWith('image/');
  const document = isImage
    ? { type: 'image_url', image_url: dataUrl }
    : { type: 'document_url', document_url: dataUrl };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: useModel,
      document,
      include_image_base64: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Mistral OCR API error ${res.status}: ${errText.substring(0, 300)}`
    );
  }

  const data = await res.json();

  // Pages array contains { index, markdown, images, dimensions } per page.
  const pages = Array.isArray(data?.pages) ? data.pages : [];
  const text = pages
    .map((p) => p?.markdown || '')
    .filter(Boolean)
    .join('\n\n---\n\n');

  if (!text) {
    throw new Error('Mistral OCR returned no text');
  }

  const pageCount = pages.length || 1;
  const costInr = estimateCostInr(pageCount);

  return {
    text,
    model: useModel,
    pages: pageCount,
    costInr,
    raw: { filename, mimeType }, // for downstream debug only
  };
}

function estimateCostInr(pages) {
  const inrPerUsd = Number(process.env.OCR_INR_PER_USD || '83');
  const usdCost = pages * USD_PER_PAGE;
  return Number((usdCost * inrPerUsd).toFixed(6));
}

export const meta = {
  name: 'mistral_ocr',
  defaultModel: DEFAULT_MODEL,
  scopes: ['ocr'],
};

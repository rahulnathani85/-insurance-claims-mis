// ============================================================
// lib/aiClients/providers/textract.js
// ------------------------------------------------------------
// AWS Textract provider — alternate OCR path (text-only).
// Selected via env OCR_PROVIDER=textract.
//
// We intentionally use DetectDocumentText (the "text only" API)
// not AnalyzeDocument (which costs ~12x more and surfaces forms /
// tables we don't need at this stage).
//
// Pricing reference (USD):
//   - DetectDocumentText: $0.0015 / page (first 1M pages/month)
//
// NOTE: requires installing @aws-sdk/client-textract. Stage 3a
// does NOT install it (since Mistral is our default). If you flip
// OCR_PROVIDER=textract, install the SDK first:
//
//   npm install @aws-sdk/client-textract
//
// The dynamic import below throws a clear, actionable error if
// the SDK isn't present.
// ============================================================

import { dynamicImport } from '../utils';

const USD_PER_PAGE = 0.0015;

export async function extract({ buffer, mimeType, filename, region }) {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set; cannot use Textract'
    );
  }

  let textractMod;
  try {
    textractMod = await dynamicImport('@aws-sdk/client-textract');
  } catch (err) {
    throw new Error(
      '@aws-sdk/client-textract not installed. Run: npm install @aws-sdk/client-textract'
    );
  }
  const { TextractClient, DetectDocumentTextCommand } = textractMod;

  const useRegion = region || process.env.AWS_REGION || 'ap-south-1';
  const client = new TextractClient({
    region: useRegion,
    credentials: { accessKeyId, secretAccessKey },
  });

  // DetectDocumentText accepts JPEG / PNG / PDF up to 10 MB sync.
  // Larger PDFs need StartDocumentTextDetection (async); not used here.
  const cmd = new DetectDocumentTextCommand({
    Document: { Bytes: Buffer.from(buffer) },
  });

  const res = await client.send(cmd);

  // Pull only LINE-type blocks; PAGE blocks give us page count.
  const blocks = res?.Blocks || [];
  const text = blocks
    .filter((b) => b.BlockType === 'LINE' && typeof b.Text === 'string')
    .map((b) => b.Text)
    .join('\n');

  const pages =
    blocks.filter((b) => b.BlockType === 'PAGE').length || 1;

  if (!text) {
    throw new Error('Textract returned no text');
  }

  const costInr = estimateCostInr(pages);

  return {
    text,
    model: 'textract-detect-document-text',
    pages,
    costInr,
    raw: { filename, mimeType, region: useRegion },
  };
}

function estimateCostInr(pages) {
  const inrPerUsd = Number(process.env.OCR_INR_PER_USD || '83');
  const usdCost = pages * USD_PER_PAGE;
  return Number((usdCost * inrPerUsd).toFixed(6));
}

export const meta = {
  name: 'textract',
  defaultModel: 'textract-detect-document-text',
  scopes: ['ocr'],
};

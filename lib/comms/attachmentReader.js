// ============================================================
// lib/comms/attachmentReader.js
// ------------------------------------------------------------
// Stage 3c — for a single inbox_messages row, downloads each
// attachment from Supabase Storage and runs OCR via the new
// ocrClient. Returns the per-attachment text + a concatenated
// blob suitable for stuffing into the LLM prompt.
//
// OCR provider selection lives in lib/aiClients/ocrClient.js.
// Default is Mistral OCR; OCR_PROVIDER=textract switches to AWS.
//
// Skipped MIME types:
//   - Anything that isn't application/pdf or image/*
//     (text/plain, text/html, .eml etc. — body already covers these)
//   - Files >25 MB (Mistral OCR cap)
//
// Failure mode: a single attachment failure is non-fatal — the
// extractor still proceeds with whatever OCR text was produced.
// ============================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { extractText } from '@/lib/aiClients';

const STORAGE_BUCKET = 'comms-attachments';
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

function isOcrCandidate(mimeType) {
  if (!mimeType) return false;
  const m = mimeType.toLowerCase();
  return m === 'application/pdf' || m.startsWith('image/');
}

// ------------------------------------------------------------
// readAttachmentsForMessage({ messageId, triggeredBy })
//
// Returns:
//   {
//     perAttachment: [
//       { attachment_id, filename, mime_type, size_bytes,
//         text?, pages?, provider?, costInr?, error?, skipped?, reason? }
//     ],
//     combinedText: string,   // page-joined OCR text across all attachments
//     totalPages: int,
//     totalCostInr: number,
//     skippedCount: int,
//     errorCount: int,
//   }
// ------------------------------------------------------------
export async function readAttachmentsForMessage({ messageId, triggeredBy = 'auto' }) {
  const { data: attachments, error } = await supabaseAdmin
    .from('message_attachments')
    .select('id, filename, mime_type, size_bytes, storage_path')
    .eq('message_id', messageId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`message_attachments fetch failed: ${error.message}`);
  }

  const result = {
    perAttachment: [],
    combinedText: '',
    totalPages: 0,
    totalCostInr: 0,
    skippedCount: 0,
    errorCount: 0,
  };

  if (!attachments || attachments.length === 0) {
    return result;
  }

  const combinedChunks = [];

  for (const att of attachments) {
    const base = {
      attachment_id: att.id,
      filename: att.filename,
      mime_type: att.mime_type,
      size_bytes: att.size_bytes,
    };

    // Filter by MIME type.
    if (!isOcrCandidate(att.mime_type)) {
      result.perAttachment.push({
        ...base,
        skipped: true,
        reason: `mime_type ${att.mime_type || '(none)'} is not a PDF or image`,
      });
      result.skippedCount += 1;
      continue;
    }

    // Filter by size.
    if (att.size_bytes && att.size_bytes > MAX_BYTES) {
      result.perAttachment.push({
        ...base,
        skipped: true,
        reason: `file size ${att.size_bytes} bytes exceeds OCR cap of ${MAX_BYTES}`,
      });
      result.skippedCount += 1;
      continue;
    }

    // Download from Storage.
    let buffer;
    try {
      const { data: blob, error: dlErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .download(att.storage_path);
      if (dlErr) throw dlErr;
      const arrayBuf = await blob.arrayBuffer();
      buffer = Buffer.from(arrayBuf);
    } catch (err) {
      result.perAttachment.push({
        ...base,
        error: `storage download failed: ${err?.message || err}`,
      });
      result.errorCount += 1;
      continue;
    }

    // OCR.
    try {
      const ocr = await extractText({
        buffer,
        mimeType: att.mime_type,
        filename: att.filename,
        messageId,
        attachmentId: att.id,
        triggeredBy,
      });
      result.perAttachment.push({
        ...base,
        text: ocr.text,
        pages: ocr.pages,
        provider: ocr.provider,
        model: ocr.model,
        costInr: ocr.costInr,
        latencyMs: ocr.latencyMs,
      });
      result.totalPages += ocr.pages || 0;
      result.totalCostInr += ocr.costInr || 0;
      combinedChunks.push(`=== ${att.filename} ===\n${ocr.text}`);
    } catch (err) {
      result.perAttachment.push({
        ...base,
        error: `OCR failed: ${err?.message || err}`,
      });
      result.errorCount += 1;
    }
  }

  result.combinedText = combinedChunks.join('\n\n');
  return result;
}

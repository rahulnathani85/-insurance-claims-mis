// ============================================================
// lib/comms/claimDocumentReader.js
// ------------------------------------------------------------
// Reads + OCRs documents on the unified claim_documents table.
// Mirrors the shape of readAttachmentsForMessage (which operates
// on message_attachments) but is the source-agnostic version
// the Registration Agent uses now that PR #38 unified the
// document store.
//
// Cache: claim_documents.ocr_text (added by migration
// 20260504073537_claim_documents_ocr_text.sql). On every read,
// rows with non-empty ocr_text are returned as-is (cache hit);
// empty rows trigger an OCR call and the result is written back
// so subsequent calls are free.
//
// Storage buckets:
//   source='gmail'        → comms-attachments (where the comms
//                            ingest pipeline put the file)
//   source='upload'       → claim-documents
//   source='generated'    → claim-documents (LOR/ILA/FSR PDFs)
//   anything else         → claim-documents (default)
//
// MIME filter: only PDF + image/* are OCR'd. Other types are
// returned with skipped=true so the caller can still see what
// the claim has.
// ============================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { extractText } from '@/lib/aiClients';

const COMMS_BUCKET   = 'comms-attachments';
const CLAIMS_BUCKET  = 'claim-documents';
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB (Mistral OCR cap)

function isOcrCandidate(mimeType) {
  if (!mimeType) return false;
  const m = mimeType.toLowerCase();
  return m === 'application/pdf' || m.startsWith('image/');
}

function bucketForSource(source) {
  if (source === 'gmail') return COMMS_BUCKET;
  return CLAIMS_BUCKET;
}

// ------------------------------------------------------------
// readClaimDocuments({ claimId, triggeredBy })
//
// Returns the same shape as readAttachmentsForMessage so the
// Registration Agent's prompt builder can consume either one.
//
//   {
//     perDocument: [
//       { document_id, filename, mime_type, size_bytes,
//         text?, pages?, provider?, costInr?, error?, skipped?,
//         reason?, cached? }
//     ],
//     combinedText: string,
//     totalPages: int,
//     totalCostInr: number,
//     skippedCount: int,
//     errorCount: int,
//   }
// ------------------------------------------------------------
export async function readClaimDocuments({ claimId, triggeredBy = 'auto' }) {
  const { data: docs, error } = await supabaseAdmin
    .from('claim_documents')
    .select('id, file_name, mime_type, file_size, storage_path, source, ocr_text')
    .eq('claim_id', claimId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`claim_documents fetch failed: ${error.message}`);
  }

  const result = {
    perDocument: [],
    combinedText: '',
    totalPages: 0,
    totalCostInr: 0,
    skippedCount: 0,
    errorCount: 0,
  };

  if (!docs || docs.length === 0) {
    return result;
  }

  const combinedChunks = [];

  for (const doc of docs) {
    const base = {
      document_id: doc.id,
      filename: doc.file_name,
      mime_type: doc.mime_type,
      size_bytes: doc.file_size,
    };

    // Cache hit — already OCR'd previously. Skip download + LLM call.
    if (typeof doc.ocr_text === 'string' && doc.ocr_text.length > 0) {
      result.perDocument.push({
        ...base,
        text: doc.ocr_text,
        cached: true,
      });
      combinedChunks.push(`=== ${doc.file_name} ===\n${doc.ocr_text}`);
      continue;
    }

    // MIME filter.
    if (!isOcrCandidate(doc.mime_type)) {
      result.perDocument.push({
        ...base,
        skipped: true,
        reason: `mime_type ${doc.mime_type || '(none)'} is not a PDF or image`,
      });
      result.skippedCount += 1;
      continue;
    }

    // Size filter.
    if (doc.file_size && doc.file_size > MAX_BYTES) {
      result.perDocument.push({
        ...base,
        skipped: true,
        reason: `file size ${doc.file_size} bytes exceeds OCR cap of ${MAX_BYTES}`,
      });
      result.skippedCount += 1;
      continue;
    }

    if (!doc.storage_path) {
      result.perDocument.push({
        ...base,
        skipped: true,
        reason: 'no storage_path on row',
      });
      result.skippedCount += 1;
      continue;
    }

    // Download.
    const bucket = bucketForSource(doc.source);
    let buffer;
    try {
      const { data: blob, error: dlErr } = await supabaseAdmin.storage
        .from(bucket)
        .download(doc.storage_path);
      if (dlErr) throw dlErr;
      const arrayBuf = await blob.arrayBuffer();
      buffer = Buffer.from(arrayBuf);
    } catch (err) {
      result.perDocument.push({
        ...base,
        error: `storage download failed (${bucket}): ${err?.message || err}`,
      });
      result.errorCount += 1;
      continue;
    }

    // OCR.
    try {
      const ocr = await extractText({
        buffer,
        mimeType: doc.mime_type,
        filename: doc.file_name,
        // Pass claimId so ai_call_log entries are properly attributed.
        claimId,
        documentId: doc.id,
        triggeredBy,
      });

      // Cache the result on the row so future reads skip the OCR call.
      // Non-fatal on failure — we still return the OCR text in this call.
      try {
        await supabaseAdmin
          .from('claim_documents')
          .update({ ocr_text: ocr.text || '' })
          .eq('id', doc.id);
      } catch (cacheErr) {
        console.warn('[claimDocumentReader] ocr_text cache write failed:', cacheErr?.message || cacheErr);
      }

      result.perDocument.push({
        ...base,
        text: ocr.text,
        pages: ocr.pages,
        provider: ocr.provider,
        model: ocr.model,
        costInr: ocr.costInr,
        latencyMs: ocr.latencyMs,
        cached: false,
      });
      result.totalPages += ocr.pages || 0;
      result.totalCostInr += ocr.costInr || 0;
      combinedChunks.push(`=== ${doc.file_name} ===\n${ocr.text}`);
    } catch (err) {
      result.perDocument.push({
        ...base,
        error: `OCR failed: ${err?.message || err}`,
      });
      result.errorCount += 1;
    }
  }

  result.combinedText = combinedChunks.join('\n\n');
  return result;
}

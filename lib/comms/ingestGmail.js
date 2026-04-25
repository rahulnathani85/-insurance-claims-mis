// ============================================================
// lib/comms/ingestGmail.js
// ------------------------------------------------------------
// Ingest logic for ONE Gmail mailbox (shared or per-user opt-in).
//
// Called from the cron endpoint /api/comms-cron/gmail for each
// row in gmail_tokens where is_comms_mailbox OR is_comms_opted_in.
//
// Dedup: inbox_messages has UNIQUE (source, source_msg_id), so
// retrying the same Gmail message ID is a no-op at the DB layer.
// We additionally label the Gmail message 'comms-processed' so
// the next poll's `-label:comms-processed` filter skips it.
//
// Privacy for per-user opt-in: we filter message metadata
// (subject + From) against per-company claim-ref regexes before
// we fetch the full body or any attachments. Messages that don't
// match are never touched beyond headers.
// ============================================================

import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  getValidCommsToken,
  listGmailMessages,
  getGmailMessageMetadata,
  getGmailMessageFull,
  getGmailAttachment,
  modifyGmailLabels,
  getOrCreateCommsProcessedLabel,
  getHeader,
  collectAttachmentParts,
  extractPlainBody,
  extractHtmlBody,
} from './gmailClient';

const STORAGE_BUCKET = 'comms-attachments';
const MAX_MESSAGES_PER_RUN = 25; // cap to keep cron runs bounded
const PER_USER_LOOKBACK = '2d';  // only scan last 2d for opt-in mailboxes

// ------------------------------------------------------------
// loadRefPatterns(company)
// Returns an array of RegExp objects active for this company.
// Patterns come from the comms_ref_patterns table.
// ------------------------------------------------------------
async function loadRefPatterns(company) {
  const { data, error } = await supabaseAdmin
    .from('comms_ref_patterns')
    .select('pattern')
    .eq('company', company)
    .eq('is_active', true);
  if (error || !data) return [];
  return data
    .map((r) => {
      try {
        return new RegExp(r.pattern, 'i');
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function matchesAnyPattern(text, patterns) {
  if (!text || patterns.length === 0) return false;
  return patterns.some((re) => re.test(text));
}

// ------------------------------------------------------------
// ingestFromMailbox(tokenRow)
// Returns a summary object suitable for writing to ingestion_runs.
// ------------------------------------------------------------
export async function ingestFromMailbox(tokenRow) {
  const company = tokenRow.company;
  if (!company) {
    return {
      ok: false,
      error: 'Mailbox has no company assigned',
      fetched: 0,
      inserted: 0,
      failed: 0,
    };
  }

  // Ingestion run row — start.
  const { data: runRow } = await supabaseAdmin
    .from('ingestion_runs')
    .insert([{
      source: 'email_gmail',
      mailbox_user_email: tokenRow.user_email,
      company,
    }])
    .select('id')
    .single();
  const runId = runRow?.id;

  let fetched = 0;
  let inserted = 0;
  let failed = 0;
  let lastError = null;

  try {
    const accessToken = await getValidCommsToken(tokenRow);
    if (!accessToken) {
      throw new Error('Token refresh failed');
    }

    // Ensure the comms-processed label exists on this mailbox.
    const processedLabelId = await getOrCreateCommsProcessedLabel(accessToken);

    // Build the Gmail search query.
    //   Shared mailbox:  scan unread, excluding already-processed
    //   Per-user opt-in: scan recent (PER_USER_LOOKBACK), excluding processed.
    //                    We intentionally do NOT use is:unread for opt-in
    //                    because users read their own mail.
    const q = tokenRow.is_comms_mailbox
      ? 'is:unread -label:comms-processed'
      : `newer_than:${PER_USER_LOOKBACK} -label:comms-processed`;

    const summaries = await listGmailMessages(accessToken, {
      q,
      maxResults: MAX_MESSAGES_PER_RUN,
    });
    fetched = summaries.length;

    // For per-user opt-in, filter by claim-ref regex before full fetch.
    let refPatterns = [];
    if (tokenRow.is_comms_opted_in) {
      refPatterns = await loadRefPatterns(company);
    }

    for (const { id: messageId } of summaries) {
      try {
        // Per-user: cheap metadata fetch + regex gate.
        if (tokenRow.is_comms_opted_in && !tokenRow.is_comms_mailbox) {
          const meta = await getGmailMessageMetadata(accessToken, messageId);
          const headers = meta.payload?.headers || [];
          const subject = getHeader(headers, 'Subject');
          const snippet = meta.snippet || '';
          if (!matchesAnyPattern(`${subject}\n${snippet}`, refPatterns)) {
            // No claim reference visible — leave this message alone.
            continue;
          }
        }

        // Full fetch.
        const full = await getGmailMessageFull(accessToken, messageId);
        const headers = full.payload?.headers || [];

        const subject = getHeader(headers, 'Subject');
        const from = getHeader(headers, 'From');
        const to = getHeader(headers, 'To');
        const cc = getHeader(headers, 'Cc');
        const dateHeader = getHeader(headers, 'Date');
        const messageIdHeader = getHeader(headers, 'Message-Id');

        const receivedAt = parseGmailDate(full.internalDate, dateHeader);
        const bodyPlain = extractPlainBody(full.payload) || '';
        const bodyHtml = extractHtmlBody(full.payload) || null;

        const attachmentParts = collectAttachmentParts(full.payload);

        // Insert inbox_messages row (idempotent via UNIQUE).
        const { data: insertedRows, error: insErr } = await supabaseAdmin
          .from('inbox_messages')
          .insert([{
            source: 'email_gmail',
            source_msg_id: messageId,
            thread_id: full.threadId || null,
            from_address: from || '(unknown)',
            from_display: parseDisplayName(from),
            to_address: to || null,
            cc_addresses: cc ? splitAddresses(cc) : [],
            subject: subject || null,
            body_plain: bodyPlain,
            body_html: bodyHtml,
            received_at: receivedAt,
            raw_headers: buildRawHeadersJson(headers, messageIdHeader),
            attachments_count: attachmentParts.length,
            status: 'received',
            company,
            mailbox_user_email: tokenRow.user_email,
          }])
          .select('id')
          .single();

        if (insErr) {
          // Duplicate (23505) means we've already ingested; still safe to label.
          if (insErr.code !== '23505') {
            throw insErr;
          }
        } else {
          inserted += 1;
        }

        // Attachments — only if we actually inserted a new row.
        if (insertedRows?.id && attachmentParts.length > 0) {
          await downloadAndStoreAttachments({
            accessToken,
            gmailMessageId: messageId,
            dbMessageId: insertedRows.id,
            attachmentParts,
            company,
          });
        }

        // Label the Gmail message so we don't re-process it.
        await modifyGmailLabels(accessToken, messageId, {
          addLabelIds: [processedLabelId],
        });
      } catch (perMsgErr) {
        failed += 1;
        lastError = perMsgErr?.message || String(perMsgErr);
        console.warn('[comms/ingest] per-message failure', messageId, lastError);
      }
    }

    if (runId) {
      await supabaseAdmin
        .from('ingestion_runs')
        .update({
          completed_at: new Date().toISOString(),
          messages_fetched: fetched,
          messages_new: inserted,
          messages_failed: failed,
          error_message: lastError,
        })
        .eq('id', runId);
    }

    return { ok: true, fetched, inserted, failed, error: lastError };
  } catch (err) {
    const errMsg = err?.message || String(err);
    if (runId) {
      await supabaseAdmin
        .from('ingestion_runs')
        .update({
          completed_at: new Date().toISOString(),
          messages_fetched: fetched,
          messages_new: inserted,
          messages_failed: failed,
          error_message: errMsg,
        })
        .eq('id', runId);
    }
    return { ok: false, error: errMsg, fetched, inserted, failed };
  }
}

// ------------------------------------------------------------
// ingestAllCommsMailboxes()
// Fetch every row flagged for Comms ingestion and run in series.
// Series (not parallel) to avoid hammering Gmail rate limits when
// a single run already handles up to MAX_MESSAGES_PER_RUN each.
// ------------------------------------------------------------
export async function ingestAllCommsMailboxes() {
  const { data: rows, error } = await supabaseAdmin
    .from('gmail_tokens')
    .select('*')
    .or('is_comms_mailbox.eq.true,is_comms_opted_in.eq.true');

  if (error) {
    return { ok: false, error: error.message, mailboxes: [] };
  }

  const mailboxes = [];
  for (const row of rows || []) {
    const summary = await ingestFromMailbox(row);
    mailboxes.push({
      user_email: row.user_email,
      company: row.company,
      mode: row.is_comms_mailbox ? 'shared' : 'user',
      ...summary,
    });
  }
  return { ok: true, mailboxes };
}

// ------------------------------------------------------------
// downloadAndStoreAttachments
// Uploads each attachment to Supabase Storage and inserts a
// message_attachments row.
// ------------------------------------------------------------
async function downloadAndStoreAttachments({
  accessToken,
  gmailMessageId,
  dbMessageId,
  attachmentParts,
  company,
}) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');

  for (const part of attachmentParts) {
    try {
      const attData = await getGmailAttachment(
        accessToken,
        gmailMessageId,
        part.body.attachmentId
      );
      if (!attData?.data) continue;

      const buffer = Buffer.from(
        attData.data.replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
      );
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      const safeName = String(part.filename)
        .replace(/[^a-zA-Z0-9._\-]/g, '_')
        .slice(0, 120);
      const storagePath = `comms/${company}/${yyyy}/${mm}/${dbMessageId}/${safeName}`;

      const { error: upErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, buffer, {
          contentType: part.mimeType || 'application/octet-stream',
          upsert: true,
        });
      if (upErr) {
        console.warn('[comms/ingest] storage upload failed', storagePath, upErr.message);
        continue;
      }

      const mimeType = part.mimeType || 'application/octet-stream';
      await supabaseAdmin.from('message_attachments').insert([{
        message_id: dbMessageId,
        filename: safeName,
        mime_type: mimeType,
        size_bytes: buffer.length,
        storage_path: storagePath,
        sha256_hash: hash,
        is_image: mimeType.startsWith('image/'),
      }]);
    } catch (attErr) {
      console.warn('[comms/ingest] attachment failure', part.filename, attErr?.message);
    }
  }
}

// ------------------------------------------------------------
// Header / date helpers
// ------------------------------------------------------------

function parseGmailDate(internalDate, headerDate) {
  // Gmail's internalDate is a ms-epoch string. Prefer it.
  const n = Number(internalDate);
  if (Number.isFinite(n) && n > 0) {
    return new Date(n).toISOString();
  }
  const t = Date.parse(headerDate || '');
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  return new Date().toISOString();
}

function parseDisplayName(fromHeader) {
  if (!fromHeader) return null;
  // Common format: '"Name" <email@x.com>' or 'Name <email@x.com>'
  const m = fromHeader.match(/^\s*"?([^"<]+?)"?\s*<.*>\s*$/);
  return m ? m[1].trim() : null;
}

function splitAddresses(headerValue) {
  if (!headerValue) return [];
  // Rough split on commas outside quotes. Good enough for storage.
  return String(headerValue)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildRawHeadersJson(headers, messageIdHeader) {
  const obj = {};
  for (const h of headers || []) {
    if (!h?.name) continue;
    // Keep the first occurrence of each header name.
    if (obj[h.name] === undefined) obj[h.name] = h.value;
  }
  if (messageIdHeader && !obj['Message-Id']) obj['Message-Id'] = messageIdHeader;
  return obj;
}

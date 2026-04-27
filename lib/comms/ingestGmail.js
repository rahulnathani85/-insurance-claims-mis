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
  listGmailHistory,
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

import { captureError, captureMessage } from '@/lib/observability';

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
        const r = await ingestOneGmailMessage({
          accessToken,
          gmailMessageId: messageId,
          tokenRow,
          processedLabelId,
          refPatterns,
        });
        if (r.skipped) continue;
        if (r.inserted) inserted += 1;
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
// ingestOneGmailMessage
// Per-message logic shared by the polling cron AND the Pub/Sub
// Push webhook. Throws on hard failure so the caller decides
// whether to count it as a per-message failure or abort the run.
//
// Returns: { inserted: bool, dbMessageId?: uuid, skipped?: bool }
// ------------------------------------------------------------
async function ingestOneGmailMessage({
  accessToken,
  gmailMessageId,
  tokenRow,
  processedLabelId,
  refPatterns = [],
}) {
  const company = tokenRow.company;

  // Per-user opt-in: cheap metadata fetch + regex gate before
  // we touch the body. Privacy guarantee for non-claim mail.
  if (tokenRow.is_comms_opted_in && !tokenRow.is_comms_mailbox) {
    const meta = await getGmailMessageMetadata(accessToken, gmailMessageId);
    const headers = meta.payload?.headers || [];
    const subject = getHeader(headers, 'Subject');
    const snippet = meta.snippet || '';
    if (!matchesAnyPattern(`${subject}\n${snippet}`, refPatterns)) {
      return { inserted: false, skipped: true };
    }
  }

  // Full fetch.
  const full = await getGmailMessageFull(accessToken, gmailMessageId);
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
      source_msg_id: gmailMessageId,
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

  let inserted = false;
  let dbMessageId = null;

  if (insErr) {
    // Duplicate (23505) means we've already ingested; still safe to label.
    if (insErr.code !== '23505') {
      throw insErr;
    }
  } else {
    inserted = true;
    dbMessageId = insertedRows?.id || null;
  }

  // Attachments — only if we actually inserted a new row.
  if (dbMessageId && attachmentParts.length > 0) {
    await downloadAndStoreAttachments({
      accessToken,
      gmailMessageId,
      dbMessageId,
      attachmentParts,
      company,
    });
  }

  // Label the Gmail message so we don't re-process it.
  await modifyGmailLabels(accessToken, gmailMessageId, {
    addLabelIds: [processedLabelId],
  });

  return { inserted, dbMessageId };
}

// ------------------------------------------------------------
// processGmailWebhookEvent
// Stage 4 — called by /api/comms-webhooks/gmail when a Pub/Sub
// notification fires. Diffs Gmail history since the mailbox's
// last_history_id and ingests any new messages.
//
// tokenRow:    gmail_tokens row matching the notification's
//              emailAddress
// newHistoryId: the historyId in the Pub/Sub payload (the
//              mailbox's current head)
//
// Returns: { processed, inserted, failed, skipped, lastError }
// ------------------------------------------------------------
export async function processGmailWebhookEvent(tokenRow, newHistoryId) {
  const company = tokenRow.company;
  if (!company) {
    return { ok: false, error: 'tokenRow has no company' };
  }

  const accessToken = await getValidCommsToken(tokenRow);
  if (!accessToken) {
    return { ok: false, error: 'token refresh failed' };
  }

  const processedLabelId = await getOrCreateCommsProcessedLabel(accessToken);

  let refPatterns = [];
  if (tokenRow.is_comms_opted_in) {
    refPatterns = await loadRefPatterns(company);
  }

  // Diff history. If last_history_id is null (first push after
  // connect) we fall back to a tiny lookback search — Gmail's
  // history.list requires a baseline.
  let messageIds = [];
  if (tokenRow.last_history_id) {
    try {
      const hist = await listGmailHistory(accessToken, tokenRow.last_history_id);
      const events = hist?.history || [];
      const idSet = new Set();
      for (const ev of events) {
        for (const ma of ev.messagesAdded || []) {
          if (ma.message?.id) idSet.add(ma.message.id);
        }
      }
      messageIds = [...idSet];
    } catch (err) {
      // Most likely cause: last_history_id is too old (Gmail
      // only retains history for ~1 week). Treat as a hint to
      // re-baseline rather than fail loudly.
      console.warn('[comms/ingest] history.list failed; falling back to recent search', err?.message);
    }
  }

  // Fallback / first-tick: scan last 1 day, exclude already-processed.
  if (messageIds.length === 0) {
    const summaries = await listGmailMessages(accessToken, {
      q: tokenRow.is_comms_mailbox
        ? 'is:unread -label:comms-processed newer_than:1d'
        : 'newer_than:1d -label:comms-processed',
      maxResults: 25,
    });
    messageIds = summaries.map((s) => s.id);
  }

  let inserted = 0;
  let failed = 0;
  let skipped = 0;
  let lastError = null;

  for (const gmailMessageId of messageIds) {
    try {
      const r = await ingestOneGmailMessage({
        accessToken,
        gmailMessageId,
        tokenRow,
        processedLabelId,
        refPatterns,
      });
      if (r.skipped) skipped += 1;
      else if (r.inserted) inserted += 1;
    } catch (err) {
      failed += 1;
      lastError = err?.message || String(err);
      console.warn('[comms/ingest] webhook per-message failure', gmailMessageId, lastError);
    }
  }

  // Persist the new history baseline so the next webhook diffs
  // from here. We do this even on partial failure — those
  // failed messages will be retried by the polling cron's safety
  // net (or eventually fall off the lookback window).
  if (newHistoryId) {
    await supabaseAdmin
      .from('gmail_tokens')
      .update({
        last_history_id: String(newHistoryId),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tokenRow.id);
  }

  return {
    ok: true,
    processed: messageIds.length,
    inserted,
    failed,
    skipped,
    lastError,
  };
}

// ------------------------------------------------------------
// downloadAndStoreAttachments
// Uploads each attachment to Supabase Storage and inserts a
// message_attachments row.
// ------------------------------------------------------------
export async function downloadAndStoreAttachments({
  accessToken,
  gmailMessageId,
  dbMessageId,
  attachmentParts,
  company,
}) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');

  const results = [];

  for (const part of attachmentParts) {
    const filename = part.filename || '(no filename)';
    try {
      // 1. Fetch from Gmail
      const attData = await getGmailAttachment(
        accessToken,
        gmailMessageId,
        part.body.attachmentId
      );
      if (!attData?.data) {
        results.push({ filename, status: 'failed', stage: 'gmail_fetch', error: 'no data returned' });
        continue;
      }

      const buffer = Buffer.from(
        attData.data.replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
      );
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      const safeName = String(filename)
        .replace(/[^a-zA-Z0-9._\-]/g, '_')
        .slice(0, 120);
      const storagePath = `comms/${company}/${yyyy}/${mm}/${dbMessageId}/${safeName}`;

      // 2. Upload to storage
      const { error: upErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, buffer, {
          contentType: part.mimeType || 'application/octet-stream',
          upsert: true,
        });
      if (upErr) {
        console.warn('[comms/ingest] storage upload failed', storagePath, upErr.message);
        captureMessage('Storage upload failed', 'error', {
          area: 'comms-ingest',
          stage: 'storage_upload',
          bucket: STORAGE_BUCKET,
          storagePath,
          filename,
          error: upErr.message,
          gmailMessageId,
          dbMessageId,
        });
        results.push({ filename, status: 'failed', stage: 'storage_upload', error: upErr.message });
        continue;
      }

      // 3. Insert into DB — and CHECK the error!
      const mimeType = part.mimeType || 'application/octet-stream';
      const { error: dbErr } = await supabaseAdmin.from('message_attachments').insert([{
        message_id: dbMessageId,
        filename: safeName,
        mime_type: mimeType,
        size_bytes: buffer.length,
        storage_path: storagePath,
        sha256_hash: hash,
        is_image: mimeType.startsWith('image/'),
      }]);
      if (dbErr) {
        console.warn('[comms/ingest] DB insert failed', filename, dbErr.message);
        captureMessage('message_attachments insert failed', 'error', {
          area: 'comms-ingest',
          stage: 'db_insert',
          filename,
          error: dbErr.message,
          gmailMessageId,
          dbMessageId,
        });
        results.push({ filename, status: 'failed', stage: 'db_insert', error: dbErr.message });
        continue;
      }

      results.push({ filename, status: 'success', size: buffer.length });
    } catch (attErr) {
      const msg = attErr?.message || String(attErr);
      console.warn('[comms/ingest] attachment failure', filename, msg);
      captureError(attErr, {
        area: 'comms-ingest',
        stage: 'attachment-loop-exception',
        filename,
        gmailMessageId,
        dbMessageId,
      });
      results.push({ filename, status: 'failed', stage: 'exception', error: msg });
    }
  }

  return results;
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

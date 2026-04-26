// ============================================================
// lib/comms/gmailClient.js
// ------------------------------------------------------------
// Gmail API helpers for the Communications Intelligence module.
//
// As of Stage 2 (Delta C), shared-mailbox AND per-user-opt-in
// flows share a SINGLE Google OAuth client (`GMAIL_CLIENT_ID` /
// `GMAIL_CLIENT_SECRET`). They differ only in:
//   - the redirect URI (each flow has its own callback route)
//   - the `mode` field on `comms_oauth_state` (CSRF nonce)
//
// All writes to gmail_tokens go through supabaseAdmin because
// cron jobs don't have an interactive session.
// ============================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// ------------------------------------------------------------
// Single OAuth client — same creds for shared + per-user flows.
// The `mode` is kept on the return value for the audit trail and
// for any future divergence (e.g., per-flow rate limiting).
// ------------------------------------------------------------
function getClientCredsForRow(tokenRow) {
  return {
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    mode: tokenRow?.is_comms_mailbox ? 'shared' : 'user',
  };
}

// ------------------------------------------------------------
// getValidCommsToken(tokenRow)
// Returns a non-expired access_token, refreshing if necessary.
// Writes the refreshed token back to gmail_tokens via service role.
// Returns null if refresh fails (caller should skip this mailbox).
// ------------------------------------------------------------
export async function getValidCommsToken(tokenRow) {
  if (!tokenRow) return null;

  const nowMs = Date.now();
  const expiryMs = tokenRow.token_expiry ? new Date(tokenRow.token_expiry).getTime() : 0;
  // Refresh 60s before actual expiry to avoid edge races.
  if (expiryMs - nowMs > 60_000) {
    return tokenRow.access_token;
  }

  if (!tokenRow.refresh_token) {
    console.warn('[comms/gmail] no refresh_token for', tokenRow.user_email);
    return null;
  }

  const { clientId, clientSecret } = getClientCredsForRow(tokenRow);
  if (!clientId || !clientSecret) {
    console.warn('[comms/gmail] missing OAuth client creds for mode', tokenRow);
    return null;
  }

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokenRow.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const refreshed = await res.json();
  if (refreshed.error) {
    console.warn('[comms/gmail] token refresh failed for', tokenRow.user_email, refreshed);
    return null;
  }

  const newExpiry = new Date(nowMs + (refreshed.expires_in || 3600) * 1000).toISOString();
  await supabaseAdmin
    .from('gmail_tokens')
    .update({
      access_token: refreshed.access_token,
      token_expiry: newExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tokenRow.id);

  return refreshed.access_token;
}

// ------------------------------------------------------------
// listGmailMessages(accessToken, { q, maxResults })
// Returns an array of { id, threadId } — IDs only; call
// getGmailMessageFull for full content.
// ------------------------------------------------------------
export async function listGmailMessages(accessToken, { q = '', maxResults = 50 } = {}) {
  const params = new URLSearchParams({ maxResults: String(maxResults) });
  if (q) params.set('q', q);
  const res = await fetch(`${GMAIL_API}/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error.message || 'Gmail list failed');
    err.code = data.error.code;
    throw err;
  }
  return data.messages || [];
}

// ------------------------------------------------------------
// getGmailMessageMetadata(accessToken, messageId)
// Cheap: headers only, no body/attachments. Used to filter
// per-user opt-in mailboxes by claim-ref regex before fetching full.
// ------------------------------------------------------------
export async function getGmailMessageMetadata(accessToken, messageId) {
  const url = `${GMAIL_API}/messages/${messageId}?format=metadata`
    + `&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To`
    + `&metadataHeaders=Cc&metadataHeaders=Date&metadataHeaders=Message-Id`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error.message || 'Gmail metadata fetch failed');
    err.code = data.error.code;
    throw err;
  }
  return data;
}

// ------------------------------------------------------------
// getGmailMessageFull(accessToken, messageId)
// Full content including parts/attachments metadata.
// ------------------------------------------------------------
export async function getGmailMessageFull(accessToken, messageId) {
  const res = await fetch(`${GMAIL_API}/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error.message || 'Gmail full fetch failed');
    err.code = data.error.code;
    throw err;
  }
  return data;
}

// ------------------------------------------------------------
// getGmailAttachment(accessToken, messageId, attachmentId)
// Returns { data: base64url-encoded-bytes, size }
// ------------------------------------------------------------
export async function getGmailAttachment(accessToken, messageId, attachmentId) {
  const res = await fetch(
    `${GMAIL_API}/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error.message || 'Gmail attachment fetch failed');
    err.code = data.error.code;
    throw err;
  }
  return data;
}

// ------------------------------------------------------------
// modifyGmailLabels(accessToken, messageId, { addLabelIds, removeLabelIds })
// Apply/remove labels. Used to mark messages as comms-processed
// so we don't re-ingest them.
// ------------------------------------------------------------
export async function modifyGmailLabels(accessToken, messageId, { addLabelIds = [], removeLabelIds = [] } = {}) {
  const res = await fetch(`${GMAIL_API}/messages/${messageId}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  });
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error.message || 'Gmail label modify failed');
    err.code = data.error.code;
    throw err;
  }
  return data;
}

// ------------------------------------------------------------
// getOrCreateCommsProcessedLabel(accessToken)
// Ensures the 'comms-processed' label exists on the mailbox and
// returns its id. Cached per-request is fine; cold miss takes
// one extra API call.
// ------------------------------------------------------------
export async function getOrCreateCommsProcessedLabel(accessToken) {
  const listRes = await fetch(`${GMAIL_API}/labels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listData = await listRes.json();
  if (listData.error) {
    const err = new Error(listData.error.message || 'Gmail labels list failed');
    err.code = listData.error.code;
    throw err;
  }
  const existing = (listData.labels || []).find(
    (l) => l.name === 'comms-processed'
  );
  if (existing) return existing.id;

  const createRes = await fetch(`${GMAIL_API}/labels`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'comms-processed',
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    }),
  });
  const created = await createRes.json();
  if (created.error) {
    const err = new Error(created.error.message || 'Gmail label create failed');
    err.code = created.error.code;
    throw err;
  }
  return created.id;
}

// ------------------------------------------------------------
// Stage 4 — Pub/Sub Push helpers
// ------------------------------------------------------------

// startGmailWatch(accessToken, topicName, [labelIds])
// Tells Gmail "publish a Pub/Sub notification to this topic
// whenever the user's mailbox changes". Returns the new
// historyId (the baseline we'll diff future deltas against)
// and expiration (ms-epoch string).
//
// Watch lasts ~7 days; renew daily via /api/comms-cron/refresh-watch.
export async function startGmailWatch(accessToken, topicName, labelIds = ['INBOX']) {
  const res = await fetch(`${GMAIL_API}/watch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topicName,
      labelIds,
      labelFilterAction: 'include',
    }),
  });
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error.message || 'Gmail watch failed');
    err.code = data.error.code;
    err.details = data.error;
    throw err;
  }
  // data has { historyId: "12345", expiration: "1730000000000" } (ms-epoch string)
  return data;
}

// stopGmailWatch(accessToken)
// Cancels the watch on this mailbox. Called when an admin
// disconnects a mailbox so no further pubsub messages fire.
export async function stopGmailWatch(accessToken) {
  const res = await fetch(`${GMAIL_API}/stop`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // 204 No Content on success.
  if (!res.ok && res.status !== 204) {
    const txt = await res.text();
    throw new Error(`Gmail stop watch failed: ${res.status} ${txt}`);
  }
  return { ok: true };
}

// listHistory(accessToken, startHistoryId)
// Returns the list of message-add events since startHistoryId.
// Used by the Push webhook to discover which message IDs are new.
//
// Returns: { historyId: string, history: [{ id, messagesAdded: [{ message: { id, threadId } }, ...] }] }
export async function listGmailHistory(accessToken, startHistoryId) {
  const params = new URLSearchParams({
    startHistoryId: String(startHistoryId),
    historyTypes: 'messageAdded',
  });
  const res = await fetch(`${GMAIL_API}/history?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error.message || 'Gmail history.list failed');
    err.code = data.error.code;
    err.details = data.error;
    throw err;
  }
  return data;
}

// ------------------------------------------------------------
// Helpers to parse Gmail payloads
// ------------------------------------------------------------

// Extract a single header value by name (case-insensitive).
export function getHeader(headers, name) {
  if (!Array.isArray(headers)) return '';
  const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

// Walk all parts of a Gmail message payload and yield attachment
// parts (ones that have a filename + attachmentId).
export function collectAttachmentParts(payload) {
  const out = [];
  function walk(part) {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      out.push(part);
    }
    if (Array.isArray(part.parts)) {
      for (const p of part.parts) walk(p);
    }
  }
  walk(payload);
  return out;
}

// Extract the text/plain body from a Gmail payload tree (recursive).
// Falls back to stripped text/html, then to snippet.
export function extractPlainBody(payload) {
  if (!payload) return '';

  function walk(part) {
    if (!part) return '';
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    if (Array.isArray(part.parts)) {
      for (const p of part.parts) {
        const found = walk(p);
        if (found) return found;
      }
    }
    return '';
  }

  const plain = walk(payload);
  if (plain) return plain;

  // Fall back: look for text/html
  function walkHtml(part) {
    if (!part) return '';
    if (part.mimeType === 'text/html' && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    if (Array.isArray(part.parts)) {
      for (const p of part.parts) {
        const found = walkHtml(p);
        if (found) return found;
      }
    }
    return '';
  }
  const html = walkHtml(payload);
  return html ? stripHtml(html) : '';
}

export function extractHtmlBody(payload) {
  function walk(part) {
    if (!part) return '';
    if (part.mimeType === 'text/html' && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    if (Array.isArray(part.parts)) {
      for (const p of part.parts) {
        const found = walk(p);
        if (found) return found;
      }
    }
    return '';
  }
  return walk(payload);
}

function decodeBase64Url(s) {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(b64, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function stripHtml(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

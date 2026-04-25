// ============================================================
// /api/communications/opt-in
// ------------------------------------------------------------
// GET    - current user's opt-in status for Comms scanning of
//          their personal Gmail.
// POST   - start OAuth flow to opt in (reuses the existing
//          GMAIL_* OAuth client so users don't face a second
//          consent screen).
// DELETE - revoke opt-in (flips is_comms_opted_in back to false).
//          We do NOT delete the gmail_tokens row because the same
//          row powers the existing per-user /email-check feature.
// ============================================================

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';
import { recordMailboxEvent } from '@/lib/comms/auditLog';

const ALLOWED_COMPANIES = ['NISLA', 'Acuere'];

// We need gmail.modify (not just readonly) so ingestion can apply
// the 'comms-processed' label and skip the message next poll.
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

// ------------------------------------------------------------
// GET - current user's opt-in status
// ------------------------------------------------------------
export async function GET(request) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;

  const { data, error } = await supabaseAdmin
    .from('gmail_tokens')
    .select('id, user_email, gmail_address, company, is_comms_opted_in, is_comms_mailbox, updated_at')
    .eq('user_email', gate.user.email)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    has_gmail_connection: !!data,
    opted_in: !!data?.is_comms_opted_in,
    gmail_address: data?.gmail_address || null,
    company: data?.company || null,
    updated_at: data?.updated_at || null,
    // Safety signal for the UI - the opt-in flow should never touch
    // a shared-mailbox row. This shouldn't ever be true for a real user
    // because shared rows use a sentinel user_email.
    is_shared_mailbox_row: !!data?.is_comms_mailbox,
  });
}

// ------------------------------------------------------------
// POST - start opt-in OAuth
// Body: { company }
// Returns: { consent_url }
// ------------------------------------------------------------
export async function POST(request) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const company = String(body.company || '').trim();
  if (!ALLOWED_COMPANIES.includes(company)) {
    return NextResponse.json(
      { error: `Invalid company. Allowed: ${ALLOWED_COMPANIES.join(', ')}` },
      { status: 400 }
    );
  }

  // Reuse the existing per-user Gmail OAuth app (GMAIL_CLIENT_ID) but
  // land the callback on a Comms-specific URI so nothing collides with
  // the existing /api/gmail/callback handler.
  const clientId = process.env.GMAIL_CLIENT_ID;
  const redirectUri = process.env.COMMS_USER_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'GMAIL_CLIENT_ID / COMMS_USER_REDIRECT_URI not configured' },
      { status: 500 }
    );
  }

  // Cryptographic nonce - avoids the CSRF-weak state=userEmail pattern
  // used by the older /api/gmail/auth route.
  const nonce = crypto.randomBytes(32).toString('hex');
  const { error: insErr } = await supabaseAdmin
    .from('comms_oauth_state')
    .insert([{
      nonce,
      mode: 'user',
      company,
      requested_by: gate.user.email,
    }]);
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Opportunistic cleanup of expired state rows (>1h old).
  await supabaseAdmin
    .from('comms_oauth_state')
    .delete()
    .lt('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', nonce);
  // Nudge Google to pre-select the user's work Gmail if possible.
  url.searchParams.set('login_hint', gate.user.email);

  return NextResponse.json({ consent_url: url.toString() });
}

// ------------------------------------------------------------
// DELETE - revoke opt-in
// Flips is_comms_opted_in to false on the user's own row.
// Does NOT delete the row - the same row is used by the
// existing /email-check feature.
// ------------------------------------------------------------
export async function DELETE(request) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;

  // Snapshot company / gmail_address BEFORE the flip so the audit row
  // captures what the user was opted into.
  const { data: priorRow } = await supabaseAdmin
    .from('gmail_tokens')
    .select('company, gmail_address')
    .eq('user_email', gate.user.email)
    .eq('is_comms_mailbox', false)
    .maybeSingle();

  // Safety: never touch a shared-mailbox row via the per-user flow.
  const { error } = await supabaseAdmin
    .from('gmail_tokens')
    .update({
      is_comms_opted_in: false,
      // Keep company column as-is; it's only meaningful while opted in.
      updated_at: new Date().toISOString(),
    })
    .eq('user_email', gate.user.email)
    .eq('is_comms_mailbox', false);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await recordMailboxEvent({
    event: 'per_user_opt_in_revoked',
    mailbox_email: priorRow?.gmail_address || null,
    company: priorRow?.company || null,
    actor_email: gate.user.email,
  });

  return NextResponse.json({ ok: true });
}

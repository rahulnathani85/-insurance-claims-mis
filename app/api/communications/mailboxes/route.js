// ============================================================
// /api/communications/mailboxes
// ------------------------------------------------------------
// GET  — list connected shared mailboxes (admin only)
// POST — start OAuth flow for a new shared mailbox (admin only)
//
// Shared mailbox rows live in the existing gmail_tokens table
// with is_comms_mailbox = true and user_email prefixed with
// 'comms-shared:' so they cannot collide with real per-user rows.
// ============================================================

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/comms/session';

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

// ------------------------------------------------------------
// GET — list shared mailboxes
// ------------------------------------------------------------
export async function GET(request) {
  const gate = await requireAdmin(request);
  if (gate.errorResponse) return gate.errorResponse;

  const { data, error } = await supabaseAdmin
    .from('gmail_tokens')
    .select('id, user_email, gmail_address, company, token_expiry, updated_at')
    .eq('is_comms_mailbox', true)
    .order('company', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const mailboxes = (data || []).map((r) => ({
    id: r.id,
    company: r.company,
    gmail_address: r.gmail_address,
    token_expiry: r.token_expiry,
    updated_at: r.updated_at,
    sentinel_key: r.user_email,
  }));

  return NextResponse.json({ mailboxes });
}

// ------------------------------------------------------------
// POST — start OAuth flow for a new shared mailbox
// Body: { company: 'NISLA' | 'Acuere' | <string> }
// Returns: { consent_url }
// ------------------------------------------------------------
export async function POST(request) {
  const gate = await requireAdmin(request);
  if (gate.errorResponse) return gate.errorResponse;

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const company = String(body.company || '').trim();
  if (!company) {
    return NextResponse.json({ error: 'company is required' }, { status: 400 });
  }

  const clientId = process.env.COMMS_GMAIL_CLIENT_ID;
  const redirectUri = process.env.COMMS_GMAIL_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'COMMS_GMAIL_CLIENT_ID / COMMS_GMAIL_REDIRECT_URI not configured' },
      { status: 500 }
    );
  }

  // Mint a random nonce and store it with 10-min TTL (enforced at callback time).
  const nonce = crypto.randomBytes(32).toString('hex');
  const { error: insErr } = await supabaseAdmin
    .from('comms_oauth_state')
    .insert([{
      nonce,
      mode: 'shared',
      company,
      requested_by: gate.user.email,
    }]);
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Opportunistic cleanup of expired state rows.
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

  return NextResponse.json({ consent_url: url.toString() });
}

// ------------------------------------------------------------
// DELETE — disconnect a shared mailbox (admin only)
// Body: { mailbox_id }
// ------------------------------------------------------------
export async function DELETE(request) {
  const gate = await requireAdmin(request);
  if (gate.errorResponse) return gate.errorResponse;

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const mailboxId = body.mailbox_id;
  if (!mailboxId) {
    return NextResponse.json({ error: 'mailbox_id is required' }, { status: 400 });
  }

  // Only allow deletion of comms shared mailboxes — never touch real user rows.
  const { error } = await supabaseAdmin
    .from('gmail_tokens')
    .delete()
    .eq('id', mailboxId)
    .eq('is_comms_mailbox', true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

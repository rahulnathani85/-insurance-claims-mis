// ============================================================
// /api/communications/mailboxes/callback
// ------------------------------------------------------------
// OAuth callback for shared-mailbox connect flow.
// Verifies the nonce against comms_oauth_state, exchanges the
// code for tokens, fetches the Gmail address via userinfo, and
// upserts gmail_tokens with is_comms_mailbox=true.
//
// The user_email field uses a sentinel prefix `comms-shared:`
// so shared-mailbox rows cannot collide with real per-user rows
// in any existing query that filters by user_email.
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { recordMailboxEvent } from '@/lib/comms/auditLog';

const STATE_TTL_MS = 10 * 60 * 1000;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const nonce = searchParams.get('state');
  const oauthError = searchParams.get('error');

  const origin = new URL(request.url).origin;
  const redirectWith = (qs) =>
    NextResponse.redirect(`${origin}/communications/mailboxes?${qs}`);

  if (oauthError) {
    return redirectWith(`error=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !nonce) {
    return redirectWith('error=missing_code_or_state');
  }

  // 1. Validate nonce + TTL + mode.
  const { data: stateRow, error: stateErr } = await supabaseAdmin
    .from('comms_oauth_state')
    .select('*')
    .eq('nonce', nonce)
    .maybeSingle();
  if (stateErr || !stateRow) {
    return redirectWith('error=invalid_state');
  }
  if (stateRow.consumed_at) {
    return redirectWith('error=state_already_used');
  }
  if (stateRow.mode !== 'shared') {
    return redirectWith('error=wrong_flow_for_state');
  }
  const age = Date.now() - new Date(stateRow.created_at).getTime();
  if (age > STATE_TTL_MS) {
    return redirectWith('error=state_expired');
  }

  // Stage 2 (Delta C): single Google OAuth client across both flows.
  // The redirect URI is what disambiguates shared vs per-user.
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.COMMS_GMAIL_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return redirectWith('error=server_misconfigured');
  }

  // 2. Exchange code for tokens.
  let tokens;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    tokens = await res.json();
  } catch (e) {
    return redirectWith('error=token_exchange_failed');
  }
  if (tokens.error || !tokens.access_token) {
    return redirectWith(`error=${encodeURIComponent(tokens.error || 'no_access_token')}`);
  }

  // 3. Fetch Gmail address via userinfo.
  let gmailAddress = null;
  try {
    const uRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await uRes.json();
    gmailAddress = profile.email || null;
  } catch {
    // Non-fatal: without gmailAddress we cannot set a sentinel key, so we do fail.
  }
  if (!gmailAddress) {
    return redirectWith('error=could_not_fetch_gmail_address');
  }

  // 4. Compute sentinel key that cannot collide with real users.
  const sentinelUserEmail = `comms-shared:${stateRow.company}:${gmailAddress.toLowerCase()}`;
  const tokenExpiry = new Date(
    Date.now() + (tokens.expires_in || 3600) * 1000
  ).toISOString();

  // 5. Upsert gmail_tokens.
  const { data: existing } = await supabaseAdmin
    .from('gmail_tokens')
    .select('id')
    .eq('user_email', sentinelUserEmail)
    .maybeSingle();

  if (existing) {
    const { error: upErr } = await supabaseAdmin
      .from('gmail_tokens')
      .update({
        access_token: tokens.access_token,
        // Keep prior refresh_token if Google didn't issue a new one.
        ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
        token_expiry: tokenExpiry,
        gmail_address: gmailAddress,
        is_comms_mailbox: true,
        company: stateRow.company,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (upErr) return redirectWith(`error=${encodeURIComponent(upErr.message)}`);
  } else {
    const { error: insErr } = await supabaseAdmin
      .from('gmail_tokens')
      .insert([{
        user_email: sentinelUserEmail,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        token_expiry: tokenExpiry,
        gmail_address: gmailAddress,
        is_comms_mailbox: true,
        company: stateRow.company,
      }]);
    if (insErr) return redirectWith(`error=${encodeURIComponent(insErr.message)}`);
  }

  // 6. Mark state as consumed so nonce cannot be replayed.
  await supabaseAdmin
    .from('comms_oauth_state')
    .update({ consumed_at: new Date().toISOString() })
    .eq('nonce', nonce);

  // 7. Audit: shared-mailbox connect event.
  await recordMailboxEvent({
    event: 'shared_mailbox_connected',
    mailbox_email: gmailAddress,
    company: stateRow.company,
    actor_email: stateRow.requested_by || null,
    details: { sentinel_user_email: sentinelUserEmail },
  });

  return redirectWith(
    `connected=1&company=${encodeURIComponent(stateRow.company)}&email=${encodeURIComponent(gmailAddress)}`
  );
}

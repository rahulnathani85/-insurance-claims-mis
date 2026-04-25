// ============================================================
// /api/communications/opt-in/callback
// ------------------------------------------------------------
// OAuth callback for the per-user Comms opt-in flow.
// Verifies the nonce (mode = 'user'), exchanges the code for
// tokens, fetches the Gmail address via userinfo, and upserts
// the user's gmail_tokens row with:
//   is_comms_opted_in = true
//   company           = <chosen at POST time>
//
// Unlike the shared-mailbox flow, this keys off the REAL user
// email (stateRow.requested_by) and does NOT use the
// 'comms-shared:' sentinel prefix. The same row is reused by
// the existing /email-check feature, so we never delete it on
// opt-out - we only flip the flag.
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { recordMailboxEvent } from '@/lib/comms/auditLog';

const STATE_TTL_MS = 10 * 60 * 1000;
const ALLOWED_COMPANIES = ['NISLA', 'Acuere'];

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const nonce = searchParams.get('state');
  const oauthError = searchParams.get('error');

  const origin = new URL(request.url).origin;
  const redirectWith = (qs) =>
    NextResponse.redirect(`${origin}/communications/opt-in?${qs}`);

  if (oauthError) {
    return redirectWith(`error=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !nonce) {
    return redirectWith('error=missing_code_or_state');
  }

  // 1. Validate state nonce + TTL + mode.
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
  if (stateRow.mode !== 'user') {
    return redirectWith('error=wrong_flow_for_state');
  }
  const age = Date.now() - new Date(stateRow.created_at).getTime();
  if (age > STATE_TTL_MS) {
    return redirectWith('error=state_expired');
  }
  if (!ALLOWED_COMPANIES.includes(stateRow.company)) {
    return redirectWith('error=invalid_company_on_state');
  }

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.COMMS_USER_REDIRECT_URI;
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
  } catch {
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
    // Fall through - gmailAddress null is handled below.
  }
  if (!gmailAddress) {
    return redirectWith('error=could_not_fetch_gmail_address');
  }

  // 4. Confirm the requesting app user still exists + is active.
  const appUserEmail = stateRow.requested_by;
  if (!appUserEmail) {
    return redirectWith('error=missing_requested_by');
  }
  const { data: appUser } = await supabaseAdmin
    .from('app_users')
    .select('id, email, is_active')
    .eq('email', appUserEmail)
    .maybeSingle();
  if (!appUser || appUser.is_active === false) {
    return redirectWith('error=user_no_longer_active');
  }

  const tokenExpiry = new Date(
    Date.now() + (tokens.expires_in || 3600) * 1000
  ).toISOString();

  // 5. Upsert the per-user row (keyed by app-user email, NOT sentinel).
  const { data: existing } = await supabaseAdmin
    .from('gmail_tokens')
    .select('id, is_comms_mailbox')
    .eq('user_email', appUserEmail)
    .maybeSingle();

  // Safety: never overwrite a shared-mailbox row via this flow.
  if (existing?.is_comms_mailbox) {
    return redirectWith('error=row_is_shared_mailbox');
  }

  if (existing) {
    const { error: upErr } = await supabaseAdmin
      .from('gmail_tokens')
      .update({
        access_token: tokens.access_token,
        // Preserve prior refresh_token if Google didn't issue a new one
        // (e.g., if the user had previously consented to the same scopes).
        ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
        token_expiry: tokenExpiry,
        gmail_address: gmailAddress,
        is_comms_opted_in: true,
        company: stateRow.company,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (upErr) return redirectWith(`error=${encodeURIComponent(upErr.message)}`);
  } else {
    const { error: insErr } = await supabaseAdmin
      .from('gmail_tokens')
      .insert([{
        user_email: appUserEmail,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        token_expiry: tokenExpiry,
        gmail_address: gmailAddress,
        is_comms_opted_in: true,
        is_comms_mailbox: false,
        company: stateRow.company,
      }]);
    if (insErr) return redirectWith(`error=${encodeURIComponent(insErr.message)}`);
  }

  // 6. Mark state consumed so nonce cannot be replayed.
  await supabaseAdmin
    .from('comms_oauth_state')
    .update({ consumed_at: new Date().toISOString() })
    .eq('nonce', nonce);

  // 7. Audit: per-user opt-in event.
  await recordMailboxEvent({
    event: 'per_user_opted_in',
    mailbox_email: gmailAddress,
    company: stateRow.company,
    actor_email: appUserEmail,
  });

  return redirectWith(
    `opted_in=1&company=${encodeURIComponent(stateRow.company)}&email=${encodeURIComponent(gmailAddress)}`
  );
}

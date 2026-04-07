import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// Gmail OAuth2 Callback - Exchange code for tokens and save
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const userEmail = searchParams.get('state'); // user_email passed as state

  if (!code || !userEmail) {
    return NextResponse.redirect(new URL('/login?error=gmail_auth_failed', request.url));
  }

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;

  try {
    // Exchange authorization code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
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

    const tokens = await tokenRes.json();

    if (tokens.error) {
      console.error('Gmail token error:', tokens);
      return NextResponse.redirect(new URL('/?gmail_error=token_exchange_failed', request.url));
    }

    // Get Gmail address from userinfo
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();

    // Save tokens to database
    const tokenExpiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

    // Upsert: update if exists, insert if new
    const { data: existing } = await supabase
      .from('gmail_tokens')
      .select('id')
      .eq('user_email', userEmail)
      .single();

    if (existing) {
      await supabase
        .from('gmail_tokens')
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || undefined,
          token_expiry: tokenExpiry,
          gmail_address: profile.email,
          updated_at: new Date().toISOString(),
        })
        .eq('user_email', userEmail);
    } else {
      await supabase
        .from('gmail_tokens')
        .insert([{
          user_email: userEmail,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expiry: tokenExpiry,
          gmail_address: profile.email,
        }]);
    }

    // Redirect back to dashboard with success message
    return NextResponse.redirect(new URL('/?gmail=connected', request.url));
  } catch (err) {
    console.error('Gmail callback error:', err);
    return NextResponse.redirect(new URL('/?gmail_error=callback_failed', request.url));
  }
}

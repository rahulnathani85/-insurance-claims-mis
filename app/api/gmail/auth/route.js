import { NextResponse } from 'next/server';

// Gmail OAuth2 - Generate authorization URL
// Requires environment variables:
//   GMAIL_CLIENT_ID - Google OAuth Client ID
//   GMAIL_CLIENT_SECRET - Google OAuth Client Secret
//   GMAIL_REDIRECT_URI - e.g. https://insurance-claims-mis-1kl7.vercel.app/api/gmail/callback

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.labels',
].join(' ');

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const userEmail = searchParams.get('user_email');

  if (!userEmail) {
    return NextResponse.json({ error: 'user_email is required' }, { status: 400 });
  }

  const clientId = process.env.GMAIL_CLIENT_ID;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'Gmail OAuth is not configured. Set GMAIL_CLIENT_ID and GMAIL_REDIRECT_URI in environment variables.' }, { status: 500 });
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&state=${encodeURIComponent(userEmail)}`;

  return NextResponse.json({ auth_url: authUrl });
}

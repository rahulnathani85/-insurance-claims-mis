import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// Helper: Refresh access token if expired
async function getValidToken(userEmail) {
  const { data: tokenData } = await supabase
    .from('gmail_tokens')
    .select('*')
    .eq('user_email', userEmail)
    .single();

  if (!tokenData) return null;

  // Check if token is expired
  if (new Date() > new Date(tokenData.token_expiry)) {
    // Refresh the token
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;

    if (!tokenData.refresh_token) return null;

    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenData.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    const refreshed = await refreshRes.json();
    if (refreshed.error) return null;

    const newExpiry = new Date(Date.now() + (refreshed.expires_in || 3600) * 1000).toISOString();
    await supabase
      .from('gmail_tokens')
      .update({
        access_token: refreshed.access_token,
        token_expiry: newExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq('user_email', userEmail);

    return refreshed.access_token;
  }

  return tokenData.access_token;
}

// GET - Fetch recent emails from user's Gmail
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const userEmail = searchParams.get('user_email');
  const query = searchParams.get('q') || ''; // Gmail search query
  const maxResults = searchParams.get('max') || '20';

  if (!userEmail) {
    return NextResponse.json({ error: 'user_email is required' }, { status: 400 });
  }

  const accessToken = await getValidToken(userEmail);
  if (!accessToken) {
    return NextResponse.json({ error: 'Gmail not connected. Please connect your Gmail account first.', needs_auth: true }, { status: 401 });
  }

  try {
    // Search emails
    let gmailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`;
    if (query) gmailUrl += `&q=${encodeURIComponent(query)}`;

    const listRes = await fetch(gmailUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const listData = await listRes.json();

    if (listData.error) {
      return NextResponse.json({ error: listData.error.message, needs_auth: listData.error.code === 401 }, { status: listData.error.code || 500 });
    }

    if (!listData.messages || listData.messages.length === 0) {
      return NextResponse.json({ messages: [] });
    }

    // Fetch details for each message (batch the first 15)
    const messageIds = listData.messages.slice(0, 15);
    const messages = await Promise.all(
      messageIds.map(async (msg) => {
        const detailRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const detail = await detailRes.json();

        const headers = detail.payload?.headers || [];
        const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

        return {
          id: detail.id,
          threadId: detail.threadId,
          subject: getHeader('Subject'),
          from: getHeader('From'),
          to: getHeader('To'),
          date: getHeader('Date'),
          snippet: detail.snippet,
          hasAttachments: (detail.payload?.parts || []).some(p => p.filename && p.filename.length > 0),
          labelIds: detail.labelIds || [],
        };
      })
    );

    return NextResponse.json({ messages });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

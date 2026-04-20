import { NextResponse } from 'next/server';

// Server-side file upload proxy.
// Client code calls this route WITHOUT any API key — the key lives only
// on the server (process.env.FILE_SERVER_KEY, no NEXT_PUBLIC_ prefix) so it
// never ships to the browser bundle.
//
// Flow:
//   Browser FormData  ─►  /api/files/upload  ─►  VPS /api/upload (+ x-api-key)
//
// The route forwards query string (folder_path) and the multipart body,
// then returns the VPS JSON response verbatim.

// URL is harmless to expose, so accept either the public or private env var.
const FILE_SERVER_URL =
  process.env.FILE_SERVER_URL ||
  process.env.NEXT_PUBLIC_FILE_SERVER_URL ||
  'http://localhost:4000';

// Key must be server-only. No fallback — fail-closed if missing.
const FILE_SERVER_KEY = process.env.FILE_SERVER_KEY;

export async function POST(request) {
  if (!FILE_SERVER_KEY) {
    return NextResponse.json(
      { error: 'Server misconfigured: FILE_SERVER_KEY env var is not set on the Next.js server.' },
      { status: 500 }
    );
  }

  try {
    // Preserve the folder_path query string as the VPS expects
    const { searchParams } = new URL(request.url);
    const folderPath = searchParams.get('folder_path') || '';

    // Parse the incoming multipart body and re-serialize to the VPS.
    // This also validates the body is actually multipart.
    const formData = await request.formData();

    const vpsUrl = `${FILE_SERVER_URL}/api/upload?folder_path=${encodeURIComponent(folderPath)}`;
    const vpsRes = await fetch(vpsUrl, {
      method: 'POST',
      headers: { 'X-API-Key': FILE_SERVER_KEY },
      body: formData,
    });

    // Try to return JSON; if VPS returned non-JSON, return raw text as error
    const contentType = vpsRes.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await vpsRes.json();
      return NextResponse.json(data, { status: vpsRes.status });
    } else {
      const text = await vpsRes.text();
      return NextResponse.json(
        { error: `Unexpected VPS response: ${text.substring(0, 200)}` },
        { status: vpsRes.status || 502 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Upload proxy failed' },
      { status: 500 }
    );
  }
}

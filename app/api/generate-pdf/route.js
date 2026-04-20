import { NextResponse } from 'next/server';

// Puppeteer server runs on port 4001 (separate from file server on 4000)
// URL is safe to ship either side; prefer server-only var, fall back to the
// legacy NEXT_PUBLIC_ var so older Vercel configs keep working.
const FILE_SERVER_URL =
  process.env.FILE_SERVER_URL ||
  process.env.NEXT_PUBLIC_FILE_SERVER_URL ||
  'http://localhost:4000';
const PUPPETEER_URL = FILE_SERVER_URL.replace(':4000', ':4001');
// Key is server-only. No fallback — fail-closed if the env var is missing.
const FILE_SERVER_KEY = process.env.FILE_SERVER_KEY;

// Proxy PDF generation to the Puppeteer server
export async function POST(request) {
  try {
    const body = await request.json();

    const res = await fetch(`${PUPPETEER_URL}/api/html-to-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': FILE_SERVER_KEY,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

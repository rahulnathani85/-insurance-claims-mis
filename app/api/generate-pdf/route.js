import { NextResponse } from 'next/server';

// Puppeteer server runs on port 4001 (separate from file server on 4000)
const FILE_SERVER_URL = process.env.NEXT_PUBLIC_FILE_SERVER_URL || 'http://localhost:4000';
const PUPPETEER_URL = FILE_SERVER_URL.replace(':4000', ':4001');
const FILE_SERVER_KEY = process.env.NEXT_PUBLIC_FILE_SERVER_KEY || 'nisla-file-server-2026';

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

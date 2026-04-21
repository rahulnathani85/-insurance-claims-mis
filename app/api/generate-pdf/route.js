import { NextResponse } from 'next/server';
import { PUPPETEER_URL, buildHeaders } from '@/lib/apiGateway';

// Proxy PDF generation to the Puppeteer server.
// In prod PUPPETEER_URL is the same HTTPS origin as the file server — Nginx
// routes /api/html-to-(pdf|docx) to :4001 and everything else /api/* to :4000.
// In dev PUPPETEER_URL falls back to http://...:4001 directly.
export async function POST(request) {
  try {
    const body = await request.json();

    const res = await fetch(`${PUPPETEER_URL}/api/html-to-pdf`, {
      method: 'POST',
      headers: buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

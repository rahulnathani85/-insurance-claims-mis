import { NextResponse } from 'next/server';
import { PUPPETEER_URL, buildHeaders } from '@/lib/apiGateway';

// Proxy DOCX generation to the Puppeteer server (which uses html-to-docx
// under the hood — see scripts/puppeteer-server/server.js:150-221). Mirrors
// /api/generate-pdf so the FSR draft page can offer "Generate Word" as a
// sibling action to "Generate PDF" with the same body contract.
//
// In prod PUPPETEER_URL is the same HTTPS origin as the file server; Nginx
// routes /api/html-to-(pdf|docx) to :4001. In dev PUPPETEER_URL falls back
// to http://...:4001 directly.
export async function POST(request) {
  try {
    const body = await request.json();

    const res = await fetch(`${PUPPETEER_URL}/api/html-to-docx`, {
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

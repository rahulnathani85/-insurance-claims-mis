import { NextResponse } from 'next/server';

const FILE_SERVER_URL = process.env.NEXT_PUBLIC_FILE_SERVER_URL || 'http://localhost:4000';
const FILE_SERVER_KEY = process.env.NEXT_PUBLIC_FILE_SERVER_KEY || 'nisla-file-server-2026';

// Proxy file downloads from the local file server through Vercel (HTTPS)
// This solves the mixed-content blocking issue (HTTPS page loading HTTP resource)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path');

    if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 });

    // Fetch from file server
    const fileRes = await fetch(`${FILE_SERVER_URL}/api/download?path=${encodeURIComponent(path)}`, {
      headers: { 'X-API-Key': FILE_SERVER_KEY },
    });

    if (!fileRes.ok) {
      return NextResponse.json({ error: 'File not found on server' }, { status: 404 });
    }

    // Get the file content and content type
    const buffer = await fileRes.arrayBuffer();
    const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
    const contentDisposition = fileRes.headers.get('content-disposition') || '';

    // Return the file with proper headers
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': buffer.byteLength.toString(),
        'Cache-Control': 'public, max-age=3600',
        ...(contentDisposition ? { 'Content-Disposition': contentDisposition } : {}),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

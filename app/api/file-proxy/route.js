import { NextResponse } from 'next/server';

// URL is safe to ship either side; prefer server-only var, fall back to the
// legacy NEXT_PUBLIC_ var so older Vercel configs keep working.
const FILE_SERVER_URL =
  process.env.FILE_SERVER_URL ||
  process.env.NEXT_PUBLIC_FILE_SERVER_URL ||
  'http://localhost:4000';
// Key is server-only. No fallback — fail-closed if the env var is missing.
const FILE_SERVER_KEY = process.env.FILE_SERVER_KEY;

// Content type map for common file extensions
const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
};

function getContentType(filePath) {
  const ext = (filePath || '').toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// Proxy file downloads from the local file server through Vercel (HTTPS)
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
      return NextResponse.json({ error: `File not found: ${fileRes.status}` }, { status: 404 });
    }

    const buffer = await fileRes.arrayBuffer();

    // Detect content type: prefer file extension over server response
    const serverContentType = fileRes.headers.get('content-type') || '';
    const extensionContentType = getContentType(path);
    // Use extension-based type if server returns generic octet-stream
    const contentType = (serverContentType === 'application/octet-stream' || !serverContentType)
      ? extensionContentType
      : serverContentType;

    // Return file with INLINE disposition (not attachment) so browser displays it
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': buffer.byteLength.toString(),
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

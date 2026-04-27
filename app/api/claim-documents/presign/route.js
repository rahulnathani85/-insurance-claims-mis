// ============================================================
// /api/claim-documents/presign
// ------------------------------------------------------------
// Returns a Supabase Storage signed upload URL so the browser
// can PUT a file directly to Supabase — bypassing the 32 MB
// Vercel serverless body limit entirely.
//
// Flow:
//   1. Browser  → POST /api/claim-documents/presign (JSON metadata)
//   2. Server   → createSignedUploadUrl() → return { signedUrl, path }
//   3. Browser  → PUT signedUrl  body=file  (goes direct to Supabase)
//   4. Browser  → POST /api/claim-documents/confirm (save DB record)
//
// Body: { claim_id, ref_number, file_name, file_type, mime_type,
//         file_size, uploaded_by, company }
// Response: { signedUrl, path, token, expiresIn }
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'claim-documents';
const EXPIRES_IN = 300; // 5 minutes — enough for large uploads

export async function POST(request) {
  try {
    const body = await request.json();
    const { claim_id, ref_number, file_name, mime_type, company } = body;

    if (!claim_id || !file_name) {
      return NextResponse.json({ error: 'claim_id and file_name are required' }, { status: 400 });
    }

    // Build storage path (same convention as the existing upload endpoint).
    const safeRef = (ref_number || claim_id).toString().replace(/[^a-zA-Z0-9\-_]/g, '_');
    const timestamp = Date.now();
    const safeName = file_name.replace(/[^a-zA-Z0-9.\-_() ]/g, '_');
    const path = `claims/${safeRef}/${timestamp}_${safeName}`;

    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { expiresIn: EXPIRES_IN });

    if (error || !data?.signedUrl) {
      console.error('[presign] createSignedUploadUrl failed:', error?.message);
      return NextResponse.json(
        { error: 'Failed to create upload URL: ' + (error?.message || 'unknown') },
        { status: 500 }
      );
    }

    return NextResponse.json({
      signedUrl: data.signedUrl,
      path,
      token: data.token,
      expiresIn: EXPIRES_IN,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

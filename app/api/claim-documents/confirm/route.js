// ============================================================
// /api/claim-documents/confirm
// ------------------------------------------------------------
// Step 3 of the presigned-upload flow. After the browser has
// PUT the file directly to Supabase Storage using the signed URL
// from /api/claim-documents/presign, it calls this endpoint to
// record the document metadata in the claim_documents table.
//
// Body: { path, claim_id, ref_number, file_name, file_type,
//         mime_type, file_size, uploaded_by, company }
// Response: same shape as existing POST /api/claim-documents
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'claim-documents';

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      path,
      claim_id,
      ref_number = '',
      file_name,
      file_type = 'other',
      mime_type,
      file_size,
      uploaded_by = '',
      company = 'NISLA',
    } = body;

    if (!path || !claim_id || !file_name) {
      return NextResponse.json(
        { error: 'path, claim_id, and file_name are required' },
        { status: 400 }
      );
    }

    // Verify the file actually landed in storage (lightweight head check).
    const { data: headData, error: headErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(path.substring(0, path.lastIndexOf('/')), {
        search: path.substring(path.lastIndexOf('/') + 1),
        limit: 1,
      });
    if (headErr || !headData || headData.length === 0) {
      return NextResponse.json(
        { error: 'File not found in storage. Upload may have failed — please retry.' },
        { status: 422 }
      );
    }

    // Record metadata.
    const { data: docRecord, error: dbError } = await supabase
      .from('claim_documents')
      .insert([{
        claim_id,
        ref_number,
        file_name,
        file_type,
        file_size: file_size || null,
        storage_path: path,
        mime_type: mime_type || null,
        uploaded_by,
        source: 'upload',
        company,
      }])
      .select()
      .single();

    if (dbError) {
      return NextResponse.json({ error: 'DB record failed: ' + dbError.message }, { status: 500 });
    }

    // Return public URL for immediate display.
    const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);

    return NextResponse.json({ ...docRecord, url: urlData?.publicUrl || null }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

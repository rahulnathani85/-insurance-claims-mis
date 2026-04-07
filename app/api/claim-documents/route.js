import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET - List documents for a claim
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claimId = searchParams.get('claim_id');
  const refNumber = searchParams.get('ref_number');

  let query = supabase.from('claim_documents').select('*').order('created_at', { ascending: false });
  if (claimId) query = query.eq('claim_id', claimId);
  if (refNumber) query = query.eq('ref_number', refNumber);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST - Upload document to Supabase Storage and record in DB
export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';

    // Handle file upload (multipart form data)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      const claimId = formData.get('claim_id');
      const refNumber = formData.get('ref_number') || '';
      const fileType = formData.get('file_type') || 'other';
      const uploadedBy = formData.get('uploaded_by') || '';
      const company = formData.get('company') || 'NISLA';

      if (!file || !claimId) {
        return NextResponse.json({ error: 'File and claim_id are required' }, { status: 400 });
      }

      // Create a safe folder path: claims/{safe_ref}/{filename}
      const safeRef = (refNumber || claimId).toString().replace(/[^a-zA-Z0-9\-_]/g, '_');
      const timestamp = Date.now();
      const fileName = file.name || 'document.pdf';
      const storagePath = `claims/${safeRef}/${timestamp}_${fileName}`;

      // Upload to Supabase Storage bucket: claim-documents
      const buffer = Buffer.from(await file.arrayBuffer());
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('claim-documents')
        .upload(storagePath, buffer, {
          contentType: file.type || 'application/pdf',
          upsert: false,
        });

      if (uploadError) {
        return NextResponse.json({ error: 'Storage upload failed: ' + uploadError.message }, { status: 500 });
      }

      // Get public/signed URL for the uploaded file
      const { data: urlData } = supabase.storage
        .from('claim-documents')
        .getPublicUrl(storagePath);

      // Record in claim_documents table
      const { data: docRecord, error: dbError } = await supabase
        .from('claim_documents')
        .insert([{
          claim_id: claimId,
          ref_number: refNumber,
          file_name: fileName,
          file_type: fileType,
          file_size: file.size,
          storage_path: storagePath,
          mime_type: file.type,
          uploaded_by: uploadedBy,
          source: 'upload',
          company,
        }])
        .select()
        .single();

      if (dbError) {
        return NextResponse.json({ error: 'DB record failed: ' + dbError.message }, { status: 500 });
      }

      return NextResponse.json({
        ...docRecord,
        url: urlData?.publicUrl || null,
      }, { status: 201 });
    }

    // Handle JSON body (legacy / document tracking without file)
    const body = await request.json();
    if (!body.claim_id) {
      return NextResponse.json({ error: 'claim_id is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('claim_documents')
      .insert([{
        claim_id: body.claim_id,
        ref_number: body.ref_number || '',
        file_name: body.file_name || body.document_name || 'Unknown',
        file_type: body.file_type || body.document_type || 'other',
        storage_path: body.storage_path || body.file_url || '',
        uploaded_by: body.uploaded_by || '',
        source: body.source || 'upload',
        company: body.company || 'NISLA',
      }])
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

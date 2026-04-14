import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const FILE_SERVER_URL = process.env.NEXT_PUBLIC_FILE_SERVER_URL || 'http://localhost:4000';
const FILE_SERVER_KEY = process.env.NEXT_PUBLIC_FILE_SERVER_KEY || 'nisla-file-server-2026';

// GET - List media for an EW claim
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const ew_claim_id = searchParams.get('ew_claim_id');
    const stage_number = searchParams.get('stage_number');

    if (!ew_claim_id) return NextResponse.json({ error: 'ew_claim_id required' }, { status: 400 });

    let query = supabaseAdmin
      .from('ew_claim_media')
      .select('*')
      .eq('ew_claim_id', ew_claim_id)
      .order('created_at', { ascending: false });

    if (stage_number) {
      query = query.eq('stage_number', parseInt(stage_number));
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Upload media file to FILE SERVER (not Supabase Storage)
export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const ew_claim_id = formData.get('ew_claim_id');
    const stage_number = formData.get('stage_number');
    const media_type = formData.get('media_type') || 'photo';
    const caption = formData.get('caption') || '';
    const uploaded_by = formData.get('uploaded_by') || '';
    const document_category = formData.get('document_category') || null;

    if (!file || !ew_claim_id) {
      return NextResponse.json({ error: 'file and ew_claim_id required' }, { status: 400 });
    }

    // Get EW claim details including linked parent claim
    const { data: ewClaim } = await supabaseAdmin
      .from('ew_vehicle_claims')
      .select('ref_number, company, claim_id, customer_name, insured_name')
      .eq('id', ew_claim_id)
      .single();

    if (!ewClaim) return NextResponse.json({ error: 'EW claim not found' }, { status: 404 });

    // Get folder_path from parent claim
    let folderPath = '';
    if (ewClaim.claim_id) {
      const { data: parentClaim } = await supabaseAdmin
        .from('claims')
        .select('folder_path')
        .eq('id', ewClaim.claim_id)
        .single();
      folderPath = parentClaim?.folder_path || '';
    }

    // If no folder_path from parent, generate one
    if (!folderPath) {
      const safeName = (ewClaim.customer_name || ewClaim.insured_name || 'Unknown').replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
      const safeRef = (ewClaim.ref_number || '').replace(/[<>:"/\\|?*]/g, '_');
      folderPath = `D:\\2026-27\\${ewClaim.company || 'NISLA'}\\Extended Warranty\\${safeRef} - ${safeName}`;
    }

    // Get the subfolder name from document category
    let subfolderName = document_category || 'General';
    if (document_category) {
      const { data: catData } = await supabaseAdmin
        .from('ew_document_categories')
        .select('subfolder_name')
        .eq('code', document_category)
        .single();
      if (catData?.subfolder_name) subfolderName = catData.subfolder_name;
    }

    // Build relative path for file server
    const relativePath = folderPath.replace(/^D:\\\\2026-27\\\\?/, '').replace(/^D:\\2026-27\\?/, '');
    const uploadFolder = `${relativePath}\\${subfolderName}`;

    // Upload to file server
    const uploadFormData = new FormData();
    const buffer = Buffer.from(await file.arrayBuffer());
    const blob = new Blob([buffer], { type: file.type });
    uploadFormData.append('files', blob, file.name);

    let fileUrl = '';
    let uploadSuccess = false;

    try {
      const uploadRes = await fetch(`${FILE_SERVER_URL}/api/upload?folder_path=${encodeURIComponent(uploadFolder)}`, {
        method: 'POST',
        headers: { 'X-API-Key': FILE_SERVER_KEY },
        body: uploadFormData,
      });
      const uploadData = await uploadRes.json();
      if (uploadData.success && uploadData.files?.length > 0) {
        fileUrl = uploadData.files[0].downloadUrl || uploadData.files[0].path || '';
        uploadSuccess = true;
      } else {
        console.warn('File server upload failed:', uploadData.error || 'Unknown error');
      }
    } catch (fsErr) {
      console.warn('File server unreachable:', fsErr.message);
    }

    // Fallback: if file server failed, try Supabase Storage
    if (!uploadSuccess) {
      try {
        const refSafe = (ewClaim.ref_number || 'unknown').replace(/[\/\\]/g, '-');
        const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const storagePath = `ew-claims/${refSafe}/${subfolderName}/${fileName}`;

        const { error: uploadErr } = await supabaseAdmin
          .storage
          .from('documents')
          .upload(storagePath, buffer, { contentType: file.type, upsert: false });

        if (uploadErr) throw uploadErr;

        const { data: urlData } = supabaseAdmin.storage.from('documents').getPublicUrl(storagePath);
        fileUrl = urlData?.publicUrl || storagePath;
        uploadSuccess = true;
      } catch (sbErr) {
        console.warn('Supabase Storage also failed:', sbErr.message);
        // Still save the DB record even if storage fails
        fileUrl = `pending-upload/${file.name}`;
      }
    }

    // Insert media record in database
    const { data: media, error: mediaErr } = await supabaseAdmin
      .from('ew_claim_media')
      .insert([{
        ew_claim_id,
        stage_number: stage_number ? parseInt(stage_number) : null,
        media_type,
        file_name: file.name,
        file_url: fileUrl,
        file_size: file.size,
        caption,
        uploaded_by,
        document_category,
        subfolder: subfolderName,
      }])
      .select()
      .single();

    if (mediaErr) throw mediaErr;

    if (!uploadSuccess) {
      return NextResponse.json({ ...media, warning: 'File record saved but file server upload failed. File may need to be re-uploaded.' }, { status: 201 });
    }

    return NextResponse.json(media, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Remove media
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    // Delete record
    const { error } = await supabaseAdmin.from('ew_claim_media').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

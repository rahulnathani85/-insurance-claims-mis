import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

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

// POST - Upload media file
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

    // Get claim ref for path
    const { data: claim } = await supabaseAdmin
      .from('ew_vehicle_claims')
      .select('ref_number, company')
      .eq('id', ew_claim_id)
      .single();

    const refSafe = (claim?.ref_number || 'unknown').replace(/[\/\\]/g, '-');
    const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const subFolder = document_category || `stage-${stage_number || 'general'}`;
    const storagePath = `ew-claims/${refSafe}/${subFolder}/${fileName}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    const { data: uploadData, error: uploadErr } = await supabaseAdmin
      .storage
      .from('documents')
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadErr) throw uploadErr;

    // Get public URL
    const { data: urlData } = supabaseAdmin
      .storage
      .from('documents')
      .getPublicUrl(storagePath);

    // Insert media record
    const { data: media, error: mediaErr } = await supabaseAdmin
      .from('ew_claim_media')
      .insert([{
        ew_claim_id,
        stage_number: stage_number ? parseInt(stage_number) : null,
        media_type,
        file_name: file.name,
        file_url: urlData?.publicUrl || storagePath,
        file_size: file.size,
        caption,
        uploaded_by,
        document_category,
      }])
      .select()
      .single();

    if (mediaErr) throw mediaErr;
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

    // Get file path first
    const { data: media } = await supabaseAdmin
      .from('ew_claim_media')
      .select('file_url')
      .eq('id', id)
      .single();

    // Delete from storage if possible
    if (media?.file_url) {
      const path = media.file_url.split('/documents/')[1];
      if (path) {
        await supabaseAdmin.storage.from('documents').remove([path]);
      }
    }

    // Delete record
    const { error } = await supabaseAdmin.from('ew_claim_media').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { FILE_SERVER_URL, buildHeaders } from '@/lib/apiGateway';
import { extractExifFromBuffer, normaliseExif } from '@/lib/exif';

// GET — list photos for a visit
export async function GET(_request, { params }) {
  const { id } = params;
  const { data, error } = await supabaseAdmin
    .from('site_visit_photos')
    .select('*')
    .eq('site_visit_id', id)
    .order('uploaded_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

// POST — upload a photo for a visit. Accepts multipart/form-data with `file`
// and optional `caption`, `uploaded_by_email`, `uploaded_by_name`.
export async function POST(request, { params }) {
  const { id } = params;

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (typeof file.size === 'number' && file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: 'file exceeds 25 MB limit' }, { status: 413 });
  }

  // Resolve the parent visit + claim — we need claim_id for the FK and
  // folder_path for file-server placement.
  const { data: visit, error: visitErr } = await supabaseAdmin
    .from('site_visits')
    .select('id, claim_id')
    .eq('id', id)
    .single();
  if (visitErr || !visit) {
    return NextResponse.json({ error: 'Site visit not found' }, { status: 404 });
  }

  const { data: claim } = await supabaseAdmin
    .from('claims')
    .select('ref_number, folder_path, company, insured_name')
    .eq('id', visit.claim_id)
    .single();

  // Read once, parse EXIF, then forward the buffer to the file server.
  const buffer = Buffer.from(await file.arrayBuffer());
  const rawExif = await extractExifFromBuffer(buffer);
  const exif = normaliseExif(rawExif);

  // Build folder path. Mirrors the EW media flow.
  const safeRef = (claim?.ref_number || `claim-${visit.claim_id}`).replace(/[<>:"/\\|?*]/g, '_');
  const safeName = (claim?.insured_name || 'Unknown').replace(/[<>:"/\\|?*]/g, '_').slice(0, 50);
  const baseFolder = claim?.folder_path
    ? claim.folder_path.replace(/^D:\\\\?2026-27\\\\?/, '').replace(/^D:\\2026-27\\?/, '')
    : `${claim?.company || 'NISLA'}\\${safeRef} - ${safeName}`;
  const uploadFolder = `${baseFolder}\\Site Visit Photos\\Visit ${visit.id}`;

  let fileUrl = '';
  try {
    const uploadFormData = new FormData();
    const blob = new Blob([buffer], { type: file.type || 'application/octet-stream' });
    uploadFormData.append('files', blob, file.name);

    const res = await fetch(`${FILE_SERVER_URL}/api/upload?folder_path=${encodeURIComponent(uploadFolder)}`, {
      method: 'POST',
      headers: buildHeaders(),
      body: uploadFormData,
    });
    const upload = await res.json();
    if (!upload.success || !upload.files?.length) {
      throw new Error(upload.error || 'File server upload failed');
    }
    const downloadPath = upload.files[0].downloadUrl || '';
    const m = downloadPath.match(/[?&]path=([^&]+)/);
    const filePath = m ? decodeURIComponent(m[1]) : '';
    fileUrl = filePath ? `/api/file-proxy?path=${encodeURIComponent(filePath)}` : '';
  } catch (e) {
    return NextResponse.json({ error: `Upload failed: ${e.message}` }, { status: 502 });
  }

  const insert = {
    site_visit_id: parseInt(id, 10),
    claim_id: visit.claim_id,
    file_name: file.name,
    file_url: fileUrl,
    file_size: file.size || null,
    mime_type: file.type || null,
    caption: nullableString(formData.get('caption')),
    taken_at: exif.taken_at,
    gps_lat: exif.gps_lat,
    gps_lng: exif.gps_lng,
    camera_make: exif.camera_make,
    camera_model: exif.camera_model,
    original_exif: exif.original_exif,
    has_geotag: exif.has_geotag,
    has_timestamp: exif.has_timestamp,
    uploaded_by_email: nullableString(formData.get('uploaded_by_email')),
    uploaded_by_name: nullableString(formData.get('uploaded_by_name')),
  };

  const { data, error } = await supabaseAdmin
    .from('site_visit_photos')
    .insert([insert])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

// DELETE — remove a photo row (file-server file is left in place; cleanup is
// a separate ops concern, matching the EW media flow).
export async function DELETE(request, { params }) {
  const { id } = params;
  const { searchParams } = new URL(request.url);
  const photoId = searchParams.get('photo_id');
  if (!photoId) return NextResponse.json({ error: 'photo_id is required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('site_visit_photos')
    .delete()
    .eq('id', photoId)
    .eq('site_visit_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

function nullableString(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s === '' ? null : s;
}

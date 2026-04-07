import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET - Get download URL for a document
export async function GET(request, { params }) {
  const { id } = params;

  const { data: doc, error } = await supabase
    .from('claim_documents')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  // Generate signed URL (valid for 1 hour)
  if (doc.storage_path) {
    const { data: signedData, error: signError } = await supabase.storage
      .from('claim-documents')
      .createSignedUrl(doc.storage_path, 3600);

    if (signedData) {
      return NextResponse.json({ ...doc, download_url: signedData.signedUrl });
    }
  }

  return NextResponse.json(doc);
}

// DELETE - Delete a document from storage and DB
export async function DELETE(request, { params }) {
  const { id } = params;

  // Get document record first
  const { data: doc, error: fetchErr } = await supabase
    .from('claim_documents')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  // Delete from Supabase Storage
  if (doc.storage_path) {
    await supabase.storage
      .from('claim-documents')
      .remove([doc.storage_path]);
  }

  // Delete from database
  const { error: delErr } = await supabase
    .from('claim_documents')
    .delete()
    .eq('id', id);

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

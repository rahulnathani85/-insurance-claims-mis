import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  const claimId = params.claimId;
  const { data: claim } = await supabase.from('claims').select('ref_number, lob').eq('id', claimId).single();
  if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

  const prefix = `claims/${claim.lob}/${claim.ref_number.replace(/\//g, '-')}/`;
  const { data: files } = await supabase.storage.from('documents').list(prefix);

  const documents = {};
  (files || []).forEach(f => {
    const parts = f.name.split('/');
    const docType = parts.length > 1 ? parts[0] : 'General';
    if (!documents[docType]) documents[docType] = [];
    documents[docType].push(f.name);
  });

  return NextResponse.json(documents);
}

export async function POST(request, { params }) {
  const claimId = params.claimId;
  const formData = await request.formData();
  const file = formData.get('file');
  const docType = formData.get('doc_type') || 'General';

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const { data: claim } = await supabase.from('claims').select('ref_number, lob').eq('id', claimId).single();
  if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

  const refSafe = claim.ref_number.replace(/\//g, '-');
  const path = `claims/${claim.lob}/${refSafe}/${docType}/${file.name}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await supabase.storage.from('documents').upload(path, buffer, { contentType: file.type, upsert: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ filename: file.name }, { status: 201 });
}

import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function POST(request, { params }) {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const filename = `policy_${params.id}_${file.name}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(`policy-copies/${filename}`, buffer, {
      contentType: file.type,
      upsert: true
    });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data: urlData } = supabase.storage
    .from('documents')
    .getPublicUrl(`policy-copies/${filename}`);

  await supabase.from('policies').update({ policy_copy_url: urlData.publicUrl }).eq('id', params.id);

  return NextResponse.json({ filename, url: urlData.publicUrl }, { status: 201 });
}

import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET - Get documents for a claim
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claimId = searchParams.get('claim_id');

  let query = supabase.from('claim_documents').select('*').order('created_at', { ascending: false });

  if (claimId) query = query.eq('claim_id', claimId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST - Add/track a document for a claim
export async function POST(request) {
  const body = await request.json();

  if (!body.claim_id || !body.document_type) {
    return NextResponse.json({ error: 'claim_id and document_type are required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('claim_documents')
    .insert([{
      claim_id: body.claim_id,
      document_type: body.document_type,
      document_name: body.document_name || body.document_type,
      status: body.status || 'Pending',
      file_url: body.file_url || null,
      generated_from_template: body.template_id || null,
      remarks: body.remarks || null,
    }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

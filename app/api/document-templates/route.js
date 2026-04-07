import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET - List templates with optional filters
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let query = supabase.from('document_templates').select('*').eq('is_active', true).order('created_at', { ascending: false });

  const type = searchParams.get('type');
  const lob = searchParams.get('lob');
  const company = searchParams.get('company');

  if (type) query = query.eq('type', type);
  if (lob) query = query.or(`lob.eq.${lob},lob.is.null`);
  if (company) query = query.eq('company', company);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST - Create a new template
export async function POST(request) {
  const body = await request.json();

  if (!body.name || !body.type || !body.content) {
    return NextResponse.json({ error: 'name, type, and content are required' }, { status: 400 });
  }

  const placeholders = JSON.stringify([
    '{{ref_number}}', '{{claim_number}}', '{{insured_name}}', '{{insurer_name}}',
    '{{lob}}', '{{policy_number}}', '{{policy_type}}', '{{date_loss}}', '{{date_intimation}}',
    '{{date_survey}}', '{{loss_location}}', '{{place_survey}}', '{{gross_loss}}',
    '{{assessed_loss}}', '{{status}}', '{{remark}}', '{{company}}',
    '{{date_today}}', '{{surveyor_name}}'
  ]);

  const { data, error } = await supabase
    .from('document_templates')
    .insert([{
      name: body.name,
      type: body.type,
      lob: body.lob || null,
      company: body.company || 'NISLA',
      content: body.content,
      placeholders: body.placeholders || placeholders,
      is_default: body.is_default || false,
      created_by: body.created_by || null,
    }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// POST - Generate a document (LOR/ILA) from template + claim data
export async function POST(request) {
  const body = await request.json();

  if (!body.claim_id || !body.type) {
    return NextResponse.json({ error: 'claim_id and type are required' }, { status: 400 });
  }

  // Get claim data
  const { data: claim, error: claimError } = await supabase
    .from('claims')
    .select('*')
    .eq('id', body.claim_id)
    .single();

  if (claimError || !claim) {
    return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  }

  // Get template if specified, otherwise use the provided content
  let finalContent = body.content || '';

  if (body.template_id) {
    const { data: template } = await supabase
      .from('document_templates')
      .select('*')
      .eq('id', body.template_id)
      .single();

    if (template) {
      finalContent = template.content;
    }
  }

  // Replace placeholders with claim data
  const today = new Date().toISOString().split('T')[0];
  const replacements = {
    '{{ref_number}}': claim.ref_number || '',
    '{{claim_number}}': claim.claim_number || '',
    '{{insured_name}}': claim.insured_name || '',
    '{{insurer_name}}': claim.insurer_name || '',
    '{{appointing_insurer}}': claim.appointing_insurer || '',
    '{{lob}}': claim.lob || '',
    '{{policy_number}}': claim.policy_number || '',
    '{{policy_type}}': claim.policy_type || '',
    '{{date_loss}}': claim.date_loss || '',
    '{{date_intimation}}': claim.date_of_intimation || '',
    '{{date_survey}}': claim.date_survey || '',
    '{{date_lor}}': claim.date_lor || '',
    '{{date_fsr}}': claim.date_fsr || '',
    '{{date_submission}}': claim.date_submission || '',
    '{{loss_location}}': claim.loss_location || '',
    '{{place_survey}}': claim.place_survey || '',
    '{{gross_loss}}': claim.gross_loss ? Number(claim.gross_loss).toLocaleString('en-IN') : '',
    '{{assessed_loss}}': claim.assessed_loss ? Number(claim.assessed_loss).toLocaleString('en-IN') : '',
    '{{status}}': claim.status || '',
    '{{remark}}': claim.remark || '',
    '{{company}}': claim.company || '',
    '{{date_today}}': today,
    '{{surveyor_name}}': body.surveyor_name || '',
    '{{vessel_name}}': claim.vessel_name || '',
    '{{consignor}}': claim.consignor || '',
    '{{consignee}}': claim.consignee || '',
    '{{chassis_number}}': claim.chassis_number || '',
  };

  for (const [key, value] of Object.entries(replacements)) {
    finalContent = finalContent.split(key).join(value);
  }

  // Save generated document
  const { data: doc, error: docError } = await supabase
    .from('generated_documents')
    .insert([{
      claim_id: body.claim_id,
      template_id: body.template_id || null,
      type: body.type,
      title: body.title || `${body.type} - ${claim.ref_number}`,
      content: finalContent,
      lob: claim.lob,
      company: claim.company,
      generated_by: body.generated_by || null,
    }])
    .select()
    .single();

  if (docError) return NextResponse.json({ error: docError.message }, { status: 400 });

  // Also track in claim_documents
  await supabase.from('claim_documents').insert([{
    claim_id: body.claim_id,
    document_type: body.type,
    document_name: `${body.type} - ${claim.ref_number}`,
    status: 'Generated',
    generated_from_template: body.template_id || null,
  }]);

  return NextResponse.json(doc, { status: 201 });
}

// GET - Get generated documents for a claim
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claimId = searchParams.get('claim_id');
  const type = searchParams.get('type');

  let query = supabase.from('generated_documents').select('*').order('created_at', { ascending: false });

  if (claimId) query = query.eq('claim_id', claimId);
  if (type) query = query.eq('type', type);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

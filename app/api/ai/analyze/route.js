import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getSystemPrompt } from '@/config/ai-prompts';

export async function POST(request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'AI not configured. Add ANTHROPIC_API_KEY to environment variables.' }, { status: 503 });

    const { claim_id, user_email } = await request.json();
    if (!claim_id) return NextResponse.json({ error: 'claim_id required' }, { status: 400 });

    // Gather claim data
    const { data: claim } = await supabaseAdmin.from('claims').select('*').eq('id', claim_id).single();
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    // Gather documents list
    const { data: docs } = await supabaseAdmin.from('claim_documents').select('file_name, file_type, mime_type, source').eq('claim_id', claim_id);

    // Build context
    const claimContext = `
CLAIM DATA:
- Ref Number: ${claim.ref_number || 'N/A'}
- LOB: ${claim.lob || 'N/A'}
- Policy Type: ${claim.policy_type || 'N/A'}
- Insured: ${claim.insured_name || 'N/A'}
- Insurer: ${claim.insurer_name || 'N/A'}
- Policy Number: ${claim.policy_number || 'N/A'}
- Date of Intimation: ${claim.date_of_intimation || 'N/A'}
- Date of Loss: ${claim.date_loss || 'N/A'}
- Loss Location: ${claim.loss_location || 'N/A'}
- Gross Loss: ${claim.gross_loss || 'N/A'}
- Status: ${claim.status || 'N/A'}
- Remark: ${claim.remark || 'N/A'}

DOCUMENTS ON FILE (${(docs || []).length} documents):
${(docs || []).map(d => `- ${d.file_name} (${d.file_type || d.mime_type || 'unknown'}, source: ${d.source || 'upload'})`).join('\n') || 'No documents uploaded yet.'}

Please analyse this claim based on the information available. If documents are listed but you cannot read their contents, note what information you would need from each document and ask the surveyor to provide key details.`;

    // Call Anthropic
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const systemPrompt = getSystemPrompt(claim.lob);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: claimContext }],
    });

    const aiMessage = response.content[0].text;

    // Save to conversation history
    await supabaseAdmin.from('claim_ai_conversations').insert([
      { claim_id, role: 'user', message: 'Analyse this claim and its documents.', created_by: user_email },
      { claim_id, role: 'assistant', message: aiMessage, created_by: 'AI' },
    ]);

    return NextResponse.json({ analysis: aiMessage, claim_ref: claim.ref_number });
  } catch (err) {
    console.error('AI analysis error:', err);
    return NextResponse.json({ error: err.message || 'AI analysis failed' }, { status: 500 });
  }
}

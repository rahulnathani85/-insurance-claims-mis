import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getSystemPrompt, FSR_GENERATION_PROMPT } from '@/config/ai-prompts';

export async function POST(request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'AI not configured. Add ANTHROPIC_API_KEY to environment variables.' }, { status: 503 });

    const { claim_id, user_email } = await request.json();
    if (!claim_id) return NextResponse.json({ error: 'claim_id required' }, { status: 400 });

    // Load claim data
    const { data: claim } = await supabaseAdmin.from('claims').select('*').eq('id', claim_id).single();
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    // Load AI conversation (analysis + Q&A)
    const { data: conversations } = await supabaseAdmin
      .from('claim_ai_conversations')
      .select('role, message')
      .eq('claim_id', claim_id)
      .order('created_at', { ascending: true });

    // Load documents list
    const { data: docs } = await supabaseAdmin.from('claim_documents').select('file_name, file_type').eq('claim_id', claim_id);

    // Build FSR context
    const claimDetails = Object.entries(claim)
      .filter(([k, v]) => v && !['id', 'created_at', 'updated_at', 'folder_path', 'company'].includes(k))
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    const conversationSummary = (conversations || [])
      .map(c => `${c.role.toUpperCase()}: ${c.message}`)
      .join('\n\n');

    const prompt = `${FSR_GENERATION_PROMPT}

CLAIM DETAILS:
${claimDetails}

DOCUMENTS ON FILE:
${(docs || []).map(d => `- ${d.file_name} (${d.file_type})`).join('\n') || 'No documents listed'}

PREVIOUS ANALYSIS & SURVEYOR ANSWERS:
${conversationSummary || 'No prior analysis available. Generate FSR based on available claim data.'}

Generate the complete FSR now in HTML format.`;

    // Call Anthropic
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: getSystemPrompt(claim.lob),
      messages: [{ role: 'user', content: prompt }],
    });

    const fsrHtml = response.content[0].text;

    // Get next version number
    const { data: existing } = await supabaseAdmin
      .from('claim_fsr_drafts')
      .select('version_number')
      .eq('claim_id', claim_id)
      .order('version_number', { ascending: false })
      .limit(1);

    const nextVersion = (existing && existing.length > 0) ? existing[0].version_number + 1 : 1;

    // Save draft
    const { data: draft, error } = await supabaseAdmin
      .from('claim_fsr_drafts')
      .insert([{
        claim_id,
        lob: claim.lob,
        draft_content: fsrHtml,
        status: 'draft',
        version_number: nextVersion,
      }])
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ draft, html: fsrHtml });
  } catch (err) {
    console.error('FSR generation error:', err);
    return NextResponse.json({ error: err.message || 'FSR generation failed' }, { status: 500 });
  }
}

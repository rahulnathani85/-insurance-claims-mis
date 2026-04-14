import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getSystemPrompt } from '@/config/ai-prompts';

export async function POST(request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'AI not configured. Add ANTHROPIC_API_KEY to environment variables.' }, { status: 503 });

    const { claim_id, message, user_email } = await request.json();
    if (!claim_id || !message) return NextResponse.json({ error: 'claim_id and message required' }, { status: 400 });

    // Load claim context
    const { data: claim } = await supabaseAdmin.from('claims').select('*').eq('id', claim_id).single();
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    // Load conversation history
    const { data: history } = await supabaseAdmin
      .from('claim_ai_conversations')
      .select('role, message')
      .eq('claim_id', claim_id)
      .order('created_at', { ascending: true });

    // Build messages array for Claude
    const claimSummary = `Claim: ${claim.ref_number}, LOB: ${claim.lob}, Insured: ${claim.insured_name}, Insurer: ${claim.insurer_name}, Policy: ${claim.policy_number}, Date of Loss: ${claim.date_loss}, Location: ${claim.loss_location}, Gross Loss: ${claim.gross_loss || 'TBD'}`;

    const messages = [];
    // Add previous conversation
    (history || []).forEach(h => {
      if (h.role === 'user' || h.role === 'assistant') {
        messages.push({ role: h.role, content: h.message });
      }
    });
    // Add new user message
    messages.push({ role: 'user', content: message });

    // Call Anthropic
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `${getSystemPrompt(claim.lob)}\n\nCLAIM CONTEXT: ${claimSummary}`,
      messages,
    });

    const aiMessage = response.content[0].text;

    // Save both messages to history
    await supabaseAdmin.from('claim_ai_conversations').insert([
      { claim_id, role: 'user', message, created_by: user_email },
      { claim_id, role: 'assistant', message: aiMessage, created_by: 'AI' },
    ]);

    return NextResponse.json({ response: aiMessage });
  } catch (err) {
    console.error('AI chat error:', err);
    return NextResponse.json({ error: err.message || 'AI chat failed' }, { status: 500 });
  }
}

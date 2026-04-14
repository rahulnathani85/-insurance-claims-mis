import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getSystemPrompt } from '@/config/ai-prompts';
import { callAI } from '@/lib/aiClient';

export async function POST(request) {
  try {
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

    const claimSummary = `Claim: ${claim.ref_number}, LOB: ${claim.lob}, Insured: ${claim.insured_name}, Insurer: ${claim.insurer_name}, Policy: ${claim.policy_number}, Date of Loss: ${claim.date_loss}, Location: ${claim.loss_location}, Gross Loss: ${claim.gross_loss || 'TBD'}`;

    // Build messages array
    const messages = [];
    (history || []).forEach(h => {
      if (h.role === 'user' || h.role === 'assistant') {
        messages.push({ role: h.role, content: h.message });
      }
    });
    messages.push({ role: 'user', content: message });

    const { text: aiMessage, provider } = await callAI({
      systemPrompt: `${getSystemPrompt(claim.lob)}\n\nCLAIM CONTEXT: ${claimSummary}`,
      messages,
    });

    // Save both messages to history
    await supabaseAdmin.from('claim_ai_conversations').insert([
      { claim_id, role: 'user', message, created_by: user_email },
      { claim_id, role: 'assistant', message: aiMessage, created_by: `AI (${provider})` },
    ]);

    return NextResponse.json({ response: aiMessage, provider });
  } catch (err) {
    console.error('AI chat error:', err);
    return NextResponse.json({ error: err.message || 'AI chat failed' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// GET - Load conversation history for a claim
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claim_id = searchParams.get('claim_id');
  if (!claim_id) return NextResponse.json({ error: 'claim_id required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('claim_ai_conversations')
    .select('*')
    .eq('claim_id', claim_id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

// DELETE - Clear conversation for a claim
export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const claim_id = searchParams.get('claim_id');
  if (!claim_id) return NextResponse.json({ error: 'claim_id required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('claim_ai_conversations')
    .delete()
    .eq('claim_id', claim_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

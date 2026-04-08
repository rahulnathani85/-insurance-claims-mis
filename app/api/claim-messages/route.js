import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET - List messages for a claim
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claimId = searchParams.get('claim_id');
  const company = searchParams.get('company');
  const limit = parseInt(searchParams.get('limit') || '100');

  if (!claimId) {
    return NextResponse.json({ error: 'claim_id is required' }, { status: 400 });
  }

  let query = supabase
    .from('claim_messages')
    .select('*')
    .eq('claim_id', claimId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (company && company !== 'All') query = query.eq('company', company);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST - Send a new message
export async function POST(request) {
  const body = await request.json();

  if (!body.claim_id || !body.message || !body.sender_email) {
    return NextResponse.json({ error: 'claim_id, message, and sender_email are required' }, { status: 400 });
  }

  // Parse mentioned_users from body (array of emails)
  const mentionedUsers = Array.isArray(body.mentioned_users) ? body.mentioned_users : [];

  const { data, error } = await supabase
    .from('claim_messages')
    .insert([{
      claim_id: body.claim_id,
      ref_number: body.ref_number || null,
      sender_email: body.sender_email,
      sender_name: body.sender_name || body.sender_email,
      message: body.message,
      message_type: body.message_type || 'text',
      is_internal: body.is_internal !== false,
      parent_id: body.parent_id || null,
      attachments: body.attachments || null,
      mentioned_users: JSON.stringify(mentionedUsers),
      company: body.company || 'NISLA',
    }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Build details string with mentions
  const mentionNames = Array.isArray(body.mentioned_names) ? body.mentioned_names : [];
  const mentionStr = mentionNames.length > 0 ? ` (tagged: ${mentionNames.join(', ')})` : '';

  // Also log this in activity_log
  await supabase.from('activity_log').insert([{
    user_email: body.sender_email,
    user_name: body.sender_name,
    action: 'message',
    entity_type: 'claim',
    entity_id: body.claim_id,
    claim_id: body.claim_id,
    ref_number: body.ref_number,
    details: `Sent message: "${body.message.substring(0, 80)}${body.message.length > 80 ? '...' : ''}"${mentionStr}`,
    company: body.company || 'NISLA',
  }]);

  return NextResponse.json(data, { status: 201 });
}

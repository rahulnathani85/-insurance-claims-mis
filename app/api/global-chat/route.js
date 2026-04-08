import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET - List global chat messages
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company');
  const limit = parseInt(searchParams.get('limit') || '100');
  const before = searchParams.get('before');

  let query = supabase
    .from('global_chat_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (company && company !== 'All') query = query.eq('company', company);
  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json((data || []).reverse());
}

// POST - Send a global chat message
export async function POST(request) {
  const body = await request.json();

  if (!body.message || !body.sender_email) {
    return NextResponse.json({ error: 'message and sender_email are required' }, { status: 400 });
  }

  const mentionedUsers = Array.isArray(body.mentioned_users) ? body.mentioned_users : [];
  const taggedRefNumbers = Array.isArray(body.tagged_ref_numbers) ? body.tagged_ref_numbers : [];

  const { data, error } = await supabase
    .from('global_chat_messages')
    .insert([{
      sender_email: body.sender_email,
      sender_name: body.sender_name || body.sender_email,
      message: body.message,
      mentioned_users: JSON.stringify(mentionedUsers),
      tagged_ref_numbers: JSON.stringify(taggedRefNumbers),
      company: body.company || 'NISLA',
    }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const mentionNames = Array.isArray(body.mentioned_names) ? body.mentioned_names : [];
  const mentionStr = mentionNames.length > 0 ? ' (tagged: ' + mentionNames.join(', ') + ')' : '';
  const refStr = taggedRefNumbers.length > 0 ? ' (files: ' + taggedRefNumbers.join(', ') + ')' : '';

  await supabase.from('activity_log').insert([{
    user_email: body.sender_email,
    user_name: body.sender_name,
    action: 'global_chat',
    entity_type: 'global_chat',
    entity_id: data.id,
    details: 'Global chat: "' + body.message.substring(0, 80) + (body.message.length > 80 ? '...' : '') + '"' + mentionStr + refStr,
    company: body.company || 'NISLA',
  }]);

  return NextResponse.json(data, { status: 201 });
}

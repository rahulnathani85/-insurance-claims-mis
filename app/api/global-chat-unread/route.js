import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET - Fetch unread global chat count for a user
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const userEmail = searchParams.get('user_email');
  const company = searchParams.get('company');

  if (!userEmail) {
    return NextResponse.json({ error: 'user_email is required' }, { status: 400 });
  }

  // Get all global chat messages
  let query = supabase
    .from('global_chat_messages')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(200);

  if (company && company !== 'All') query = query.eq('company', company);

  const { data: messages, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!messages || messages.length === 0) {
    return NextResponse.json({ unread_count: 0, unread_mention_count: 0 });
  }

  // Get read status for these messages
  const messageIds = messages.map(m => m.id);
  const { data: reads } = await supabase
    .from('global_chat_reads')
    .select('message_id')
    .eq('user_email', userEmail)
    .in('message_id', messageIds);

  const readMessageIds = new Set((reads || []).map(r => r.message_id));
  const unreadCount = messages.filter(m => !readMessageIds.has(m.id)).length;

  // Also get unread mentions specifically for bell notification
  let mentionQuery = supabase
    .from('global_chat_messages')
    .select('id')
    .like('mentioned_users', '%' + userEmail + '%')
    .order('created_at', { ascending: false })
    .limit(50);

  if (company && company !== 'All') mentionQuery = mentionQuery.eq('company', company);

  const { data: mentionMsgs } = await mentionQuery;
  let unreadMentionCount = 0;
  if (mentionMsgs && mentionMsgs.length > 0) {
    const mentionIds = mentionMsgs.map(m => m.id);
    const { data: mentionReads } = await supabase
      .from('global_chat_reads')
      .select('message_id')
      .eq('user_email', userEmail)
      .in('message_id', mentionIds);

    const readMentionIds = new Set((mentionReads || []).map(r => r.message_id));
    unreadMentionCount = mentionMsgs.filter(m => !readMentionIds.has(m.id)).length;
  }

  return NextResponse.json({
    unread_count: unreadCount,
    unread_mention_count: unreadMentionCount,
  });
}

// POST - Mark global chat messages as read
export async function POST(request) {
  const body = await request.json();

  if (!body.user_email) {
    return NextResponse.json({ error: 'user_email is required' }, { status: 400 });
  }

  // Mark specific message as read
  if (body.message_id) {
    const { error } = await supabase
      .from('global_chat_reads')
      .upsert([{
        message_id: body.message_id,
        user_email: body.user_email,
      }], { onConflict: 'message_id,user_email' });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  }

  // Mark multiple messages as read (batch)
  if (body.message_ids && Array.isArray(body.message_ids)) {
    const inserts = body.message_ids.map(id => ({
      message_id: id,
      user_email: body.user_email,
    }));
    const { error } = await supabase
      .from('global_chat_reads')
      .upsert(inserts, { onConflict: 'message_id,user_email' });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true, marked: inserts.length });
  }

  return NextResponse.json({ error: 'Provide message_id or message_ids array' }, { status: 400 });
}

import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET - Fetch unread mentions for a user
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const userEmail = searchParams.get('user_email');
  const company = searchParams.get('company');

  if (!userEmail) {
    return NextResponse.json({ error: 'user_email is required' }, { status: 400 });
  }

  // Get all messages where user is mentioned
  let query = supabase
    .from('claim_messages')
    .select('*')
    .like('mentioned_users', `%${userEmail}%`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (company && company !== 'All') query = query.eq('company', company);

  const { data: messages, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!messages || messages.length === 0) {
    return NextResponse.json({ unread: [], unread_count: 0, all_mentions: [] });
  }

  // Get read status for these messages
  const messageIds = messages.map(m => m.id);
  const { data: reads } = await supabase
    .from('message_reads')
    .select('message_id')
    .eq('user_email', userEmail)
    .in('message_id', messageIds);

  const readMessageIds = new Set((reads || []).map(r => r.message_id));

  // Separate unread and all
  const unread = messages.filter(m => !readMessageIds.has(m.id));

  return NextResponse.json({
    unread,
    unread_count: unread.length,
    all_mentions: messages,
  });
}

// POST - Mark mentions as read
export async function POST(request) {
  const body = await request.json();

  if (!body.user_email) {
    return NextResponse.json({ error: 'user_email is required' }, { status: 400 });
  }

  // Mark specific message as read
  if (body.message_id) {
    const { error } = await supabase
      .from('message_reads')
      .upsert([{
        message_id: body.message_id,
        user_email: body.user_email,
      }], { onConflict: 'message_id,user_email' });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  }

  // Mark all mentions for a specific claim as read
  if (body.claim_id) {
    // Get all message IDs for this claim where user is mentioned
    const { data: messages } = await supabase
      .from('claim_messages')
      .select('id')
      .eq('claim_id', body.claim_id)
      .like('mentioned_users', `%${body.user_email}%`);

    if (messages && messages.length > 0) {
      const inserts = messages.map(m => ({
        message_id: m.id,
        user_email: body.user_email,
      }));
      await supabase
        .from('message_reads')
        .upsert(inserts, { onConflict: 'message_id,user_email' });
    }
    return NextResponse.json({ success: true, marked: messages?.length || 0 });
  }

  // Mark ALL mentions as read
  if (body.mark_all) {
    const { data: messages } = await supabase
      .from('claim_messages')
      .select('id')
      .like('mentioned_users', `%${body.user_email}%`);

    if (messages && messages.length > 0) {
      const inserts = messages.map(m => ({
        message_id: m.id,
        user_email: body.user_email,
      }));
      await supabase
        .from('message_reads')
        .upsert(inserts, { onConflict: 'message_id,user_email' });
    }
    return NextResponse.json({ success: true, marked: messages?.length || 0 });
  }

  return NextResponse.json({ error: 'Provide message_id, claim_id, or mark_all' }, { status: 400 });
}

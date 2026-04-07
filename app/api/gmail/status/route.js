import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET - Check if user has Gmail connected
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const userEmail = searchParams.get('user_email');

  if (!userEmail) {
    return NextResponse.json({ connected: false });
  }

  const { data } = await supabase
    .from('gmail_tokens')
    .select('gmail_address, token_expiry')
    .eq('user_email', userEmail)
    .single();

  if (data) {
    return NextResponse.json({
      connected: true,
      gmail_address: data.gmail_address,
      token_valid: new Date() < new Date(data.token_expiry),
    });
  }

  return NextResponse.json({ connected: false });
}

// DELETE - Disconnect Gmail
export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const userEmail = searchParams.get('user_email');

  if (!userEmail) {
    return NextResponse.json({ error: 'user_email required' }, { status: 400 });
  }

  await supabase
    .from('gmail_tokens')
    .delete()
    .eq('user_email', userEmail);

  return NextResponse.json({ success: true });
}

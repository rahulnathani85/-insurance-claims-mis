import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function POST(request) {
  const body = await request.json();
  const { username, password, email } = body;

  // Support both username (new) and email (legacy) login
  const loginId = username || email;

  if (!loginId || !password) {
    return NextResponse.json({ error: 'User ID and password are required' }, { status: 400 });
  }

  // Try lookup by username (name field) first, then fallback to email
  let user = null;
  let error = null;

  // Try by name (case-insensitive)
  const { data: byName, error: nameErr } = await supabase
    .from('app_users')
    .select('*')
    .ilike('name', loginId.trim())
    .eq('is_active', true)
    .single();

  if (byName) {
    user = byName;
  } else {
    // Fallback: try by email
    const { data: byEmail, error: emailErr } = await supabase
      .from('app_users')
      .select('*')
      .eq('email', loginId.toLowerCase().trim())
      .eq('is_active', true)
      .single();

    if (byEmail) {
      user = byEmail;
    }
  }

  if (!user) {
    return NextResponse.json({ error: 'Invalid User ID or password' }, { status: 401 });
  }

  // Simple password check (plain text comparison)
  if (user.password_hash !== password) {
    return NextResponse.json({ error: 'Invalid User ID or password' }, { status: 401 });
  }

  // Update last login
  await supabase
    .from('app_users')
    .update({ last_login: new Date().toISOString() })
    .eq('id', user.id);

  // Log activity
  await supabase.from('activity_log').insert([{
    user_email: user.email,
    user_name: user.name,
    action: 'login',
    entity_type: 'user',
    entity_id: user.id,
    company: user.company,
  }]);

  // Return user without password
  const { password_hash, ...safeUser } = user;
  return NextResponse.json({ user: safeUser });
}

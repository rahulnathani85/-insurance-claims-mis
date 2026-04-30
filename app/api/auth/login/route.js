import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { hashPassword, verifyPassword } from '@/lib/passwords';
import { captureError } from '@/lib/observability';

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

  // Try by name (case-insensitive)
  const { data: byName } = await supabase
    .from('app_users')
    .select('*')
    .ilike('name', loginId.trim())
    .eq('is_active', true)
    .single();

  if (byName) {
    user = byName;
  } else {
    // Fallback: try by email
    const { data: byEmail } = await supabase
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

  const { ok, needsRehash } = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return NextResponse.json({ error: 'Invalid User ID or password' }, { status: 401 });
  }

  // Transparent migration: legacy plain-text rows get bcrypt-hashed on first
  // successful login. Use the service-role client so RLS doesn't block it.
  if (needsRehash) {
    try {
      const newHash = await hashPassword(password);
      await supabaseAdmin
        .from('app_users')
        .update({ password_hash: newHash })
        .eq('id', user.id);
    } catch (e) {
      // Non-fatal: login still succeeds; the row stays plain text until next
      // login. Surface via Sentry so we notice if it's persistent.
      captureError(e, { area: 'auth-login-rehash', user_id: user.id });
    }
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

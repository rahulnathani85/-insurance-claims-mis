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

  // Insurer-portal users (Phase 2): row-level integrity check. The DB
  // CHECK constraint app_users_insurer_role_pairing ensures every
  // insurer_readonly row has insurer_id NOT NULL, so this should never
  // fire — but if it does (e.g. constraint dropped, hand-edited row),
  // refuse the login rather than leak an unscoped session.
  if (user.role === 'insurer_readonly') {
    if (!user.insurer_id) {
      captureError(new Error('insurer_readonly user missing insurer_id'), {
        area: 'auth-login-insurer-no-id',
        user_id: user.id,
      });
      return NextResponse.json(
        { error: 'Account misconfigured — please contact NISLA admin.' },
        { status: 403 }
      );
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

  // Return user without password. The `redirect_to` hint tells the
  // client which landing page to push to after sessionStorage hydrate;
  // surveyor users get the regular dashboard, insurer-readonly users
  // go straight to the insurer portal.
  const { password_hash, ...safeUser } = user;
  return NextResponse.json({
    user: safeUser,
    redirect_to: user.role === 'insurer_readonly' ? '/insurer-portal' : '/',
  });
}

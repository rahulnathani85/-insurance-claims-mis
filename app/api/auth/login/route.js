import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function POST(request) {
  const { email, password } = await request.json();

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  // Look up user
  const { data: user, error } = await supabase
    .from('app_users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .eq('is_active', true)
    .single();

  if (error || !user) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  // Simple password check (plain text comparison for now)
  // In production, use bcrypt. For simplicity in V2 beta, using plain text.
  if (user.password_hash !== password) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  // Update last login
  await supabase
    .from('app_users')
    .update({ last_login: new Date().toISOString() })
    .eq('id', user.id);

  // Log activity
  await supabase.from('activity_log').insert([{
    user_email: user.email,
    action: 'login',
    entity_type: 'user',
    entity_id: user.id,
    company: user.company,
  }]);

  // Return user without password
  const { password_hash, ...safeUser } = user;
  return NextResponse.json({ user: safeUser });
}

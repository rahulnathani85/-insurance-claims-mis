import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET - List all users
export async function GET() {
  const { data, error } = await supabase
    .from('app_users')
    .select('id, email, name, role, company, is_active, last_login, created_at')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST - Create new user
export async function POST(request) {
  const body = await request.json();

  if (!body.email || !body.password || !body.name) {
    return NextResponse.json({ error: 'Email, password, and name are required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('app_users')
    .insert([{
      email: body.email.toLowerCase().trim(),
      password_hash: body.password,  // Plain text for now
      name: body.name,
      role: body.role || 'Staff',
      company: body.company || 'NISLA',
      is_active: true,
    }])
    .select('id, email, name, role, company, is_active, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Email already exists' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data, { status: 201 });
}

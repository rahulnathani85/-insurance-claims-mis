import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET single user
export async function GET(request, { params }) {
  const { id } = params;
  const { data, error } = await supabase
    .from('app_users')
    .select('id, email, name, role, company, is_active, last_login, created_at')
    .eq('id', id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

// PUT - Update user
export async function PUT(request, { params }) {
  const { id } = params;
  const body = await request.json();

  const updates = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.email !== undefined) updates.email = body.email.toLowerCase().trim();
  if (body.role !== undefined) updates.role = body.role;
  if (body.company !== undefined) updates.company = body.company;
  if (body.is_active !== undefined) updates.is_active = body.is_active;
  if (body.password && body.password.trim()) updates.password_hash = body.password;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('app_users')
    .update(updates)
    .eq('id', id)
    .select('id, email, name, role, company, is_active, last_login, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Email already exists' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data);
}

// DELETE - Deactivate user (soft delete)
export async function DELETE(request, { params }) {
  const { id } = params;
  const { error } = await supabase
    .from('app_users')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

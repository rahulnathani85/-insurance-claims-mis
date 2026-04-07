import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

function generatePolicyFolderPath(company, policyNumber, insuredName) {
  const safeName = (insuredName || 'Unknown').replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
  const safePol = (policyNumber || '').replace(/[<>:"/\\|?*]/g, '_');
  return `D:\\2026-27\\${company || 'NISLA'}\\Policies\\${safePol} - ${safeName}`;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let query = supabase.from('policies').select('*').order('created_at', { ascending: false });

  const company = searchParams.get('company');
  if (company) query = query.eq('company', company);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request) {
  const body = await request.json();
  const allowed = ['policy_number', 'insurer', 'insured_name', 'insured_address', 'city', 'phone', 'email', 'lob', 'policy_type', 'sum_insured', 'premium', 'start_date', 'end_date', 'policy_copy_url', 'company', 'risk_location', 'coverage_amount', 'description', 'folder_path'];
  const cleanBody = {};
  for (const key of allowed) {
    if (body[key] !== undefined && body[key] !== '') cleanBody[key] = body[key];
  }

  // Generate folder path
  cleanBody.folder_path = generatePolicyFolderPath(cleanBody.company, cleanBody.policy_number, cleanBody.insured_name);

  const { data, error } = await supabase.from('policies').insert([cleanBody]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id, folder_path: data.folder_path }, { status: 201 });
}

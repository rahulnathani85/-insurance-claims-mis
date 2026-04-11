import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET() {
  const { data, error } = await supabase
    .from('insurer_offices')
    .select('id, name, type, address, city, state, pin, gstin, phone, email, contact_person, insurers(company_name)')
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const offices = data.map(o => ({
    id: o.id,
    name: o.name,
    type: o.type,
    address: o.address || '',
    city: o.city || '',
    state: o.state || '',
    pin: o.pin || '',
    gstin: o.gstin || '',
    phone: o.phone || '',
    email: o.email || '',
    contact_person: o.contact_person || '',
    company: o.insurers?.company_name || ''
  }));
  return NextResponse.json(offices);
}

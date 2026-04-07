import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';
import { MARINE_CLIENT_FORMATS } from '@/lib/constants';

// LOBs that share a unified counter (cross-company)
const UNIFIED_LOBS = ['Fire', 'Engineering', 'Business Interruption', 'Miscellaneous'];
const UNIFIED_COUNTER_KEY = 'General';

// Generate reference number
async function generateRefNumber(lob, clientCategory = null, manualRefNumber = null) {
  // If manual reference number is provided, use it (but still increment counter)
  if (manualRefNumber) {
    // Still increment the counter to keep it in sync
    await incrementCounter(lob, clientCategory);
    return manualRefNumber;
  }

  if (lob === 'Marine Cargo') {
    // If a specific named client category is defined (not Others), use client-specific format
    if (clientCategory && clientCategory !== 'Others Domestic' && clientCategory !== 'Others Import') {
      const { data } = await supabase
        .from('marine_counters')
        .select('counter_value')
        .eq('client_category', clientCategory)
        .single();
      const counter = (data?.counter_value || 0) + 1;
      await supabase
        .from('marine_counters')
        .update({ counter_value: counter })
        .eq('client_category', clientCategory);
      const code = MARINE_CLIENT_FORMATS[clientCategory] || 'UNKNOWN';
      return `${code}-${String(counter).padStart(3, '0')}/26-27`;
    }
    // For generic Marine (Others Domestic/Import or no category): use Marine counter (4001, 4002, ...)
    const { data } = await supabase
      .from('ref_counters')
      .select('counter_value')
      .eq('lob', 'Marine')
      .single();
    const counter = (data?.counter_value || 4000) + 1;
    await supabase
      .from('ref_counters')
      .update({ counter_value: counter })
      .eq('lob', 'Marine');
    return `${counter}/26-27/Marine`;
  }

  // For unified LOBs (Fire, Engineering, BI, Misc), use shared "General" counter
  const counterKey = UNIFIED_LOBS.includes(lob) ? UNIFIED_COUNTER_KEY : lob;

  const { data } = await supabase
    .from('ref_counters')
    .select('counter_value')
    .eq('lob', counterKey)
    .single();
  const counter = (data?.counter_value || 0) + 1;
  await supabase
    .from('ref_counters')
    .update({ counter_value: counter })
    .eq('lob', counterKey);

  const formats = {
    'Fire': `${counter}/26-27/Fire`,
    'Engineering': `${counter}/26-27/Engg`,
    'Extended Warranty': `EW-${String(counter).padStart(4, '0')}/26-27`,
    'Business Interruption': `${counter}/26-27/BI`,
    'Miscellaneous': `${counter}/26-27/Misc.`,
    'Banking': `INS-${String(counter).padStart(4, '0')}/26-27`,
    'Liability': `${counter}/26-27/LIABILITY`,
    'Marine Hull': `${counter}/26-27/Hull`,
    'Cat Event': `${counter}/26-27/CAT`,
  };
  return formats[lob] || `${counter}/26-27/${lob}`;
}

// Helper to increment counter without generating ref number (used for manual ref)
async function incrementCounter(lob, clientCategory) {
  if (lob === 'Marine Cargo') {
    // Named client categories use marine_counters table
    if (clientCategory && clientCategory !== 'Others Domestic' && clientCategory !== 'Others Import') {
      const { data } = await supabase.from('marine_counters').select('counter_value').eq('client_category', clientCategory).single();
      await supabase.from('marine_counters').update({ counter_value: (data?.counter_value || 0) + 1 }).eq('client_category', clientCategory);
      return;
    }
    // Generic Marine uses ref_counters 'Marine' key
    const { data } = await supabase.from('ref_counters').select('counter_value').eq('lob', 'Marine').single();
    await supabase.from('ref_counters').update({ counter_value: (data?.counter_value || 4000) + 1 }).eq('lob', 'Marine');
    return;
  }
  const counterKey = UNIFIED_LOBS.includes(lob) ? UNIFIED_COUNTER_KEY : lob;
  const { data } = await supabase.from('ref_counters').select('counter_value').eq('lob', counterKey).single();
  await supabase.from('ref_counters').update({ counter_value: (data?.counter_value || 0) + 1 }).eq('lob', counterKey);
}

// Decrement counter (used when claim is deleted)
async function decrementCounter(lob, clientCategory) {
  if (lob === 'Marine Cargo') {
    // Named client categories use marine_counters table
    if (clientCategory && clientCategory !== 'Others Domestic' && clientCategory !== 'Others Import') {
      const { data } = await supabase.from('marine_counters').select('counter_value').eq('client_category', clientCategory).single();
      if (data && data.counter_value > 0) {
        await supabase.from('marine_counters').update({ counter_value: data.counter_value - 1 }).eq('client_category', clientCategory);
      }
      return;
    }
    // Generic Marine uses ref_counters 'Marine' key
    const { data } = await supabase.from('ref_counters').select('counter_value').eq('lob', 'Marine').single();
    if (data && data.counter_value > 4000) {
      await supabase.from('ref_counters').update({ counter_value: data.counter_value - 1 }).eq('lob', 'Marine');
    }
    return;
  }
  const counterKey = UNIFIED_LOBS.includes(lob) ? UNIFIED_COUNTER_KEY : lob;
  const { data } = await supabase.from('ref_counters').select('counter_value').eq('lob', counterKey).single();
  if (data && data.counter_value > 0) {
    await supabase.from('ref_counters').update({ counter_value: data.counter_value - 1 }).eq('lob', counterKey);
  }
}

// Generate folder path for claim
function generateFolderPath(company, lob, refNumber, insuredName) {
  const safeName = (insuredName || 'Unknown').replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
  const safeRef = (refNumber || '').replace(/[<>:"/\\|?*]/g, '_');
  return `D:\\2026-27\\${company}\\${lob}\\${safeRef} - ${safeName}`;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let query = supabase.from('claims').select('*').order('created_at', { ascending: false });

  const companyParam = searchParams.get('company');
  if (companyParam && companyParam !== 'All') query = query.eq('company', companyParam);
  if (companyParam === 'All') query = query.neq('company', 'Development');
  if (searchParams.get('lob')) query = query.eq('lob', searchParams.get('lob'));
  if (searchParams.get('status')) query = query.eq('status', searchParams.get('status'));
  if (searchParams.get('ref_number')) query = query.ilike('ref_number', `%${searchParams.get('ref_number')}%`);
  if (searchParams.get('insurer_name')) query = query.ilike('insurer_name', `%${searchParams.get('insurer_name')}%`);
  if (searchParams.get('insured_name')) query = query.ilike('insured_name', `%${searchParams.get('insured_name')}%`);
  if (searchParams.get('policy_number')) query = query.ilike('policy_number', `%${searchParams.get('policy_number')}%`);
  if (searchParams.get('claim_number')) query = query.ilike('claim_number', `%${searchParams.get('claim_number')}%`);
  if (searchParams.get('date_loss_from')) query = query.gte('date_loss', searchParams.get('date_loss_from'));
  if (searchParams.get('date_loss_to')) query = query.lte('date_loss', searchParams.get('date_loss_to'));
  if (searchParams.get('date_intimation_from')) query = query.gte('date_intimation', searchParams.get('date_intimation_from'));
  if (searchParams.get('date_intimation_to')) query = query.lte('date_intimation', searchParams.get('date_intimation_to'));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request) {
  const body = await request.json();
  const manualRef = body._manual_ref_number || null;
  delete body._manual_ref_number;
  delete body._tentative_ref;

  const refNumber = await generateRefNumber(body.lob, body.client_category, manualRef);
  const company = body.company || 'NISLA';
  const folderPath = generateFolderPath(company, body.lob, refNumber, body.insured_name);

  const { data, error } = await supabase
    .from('claims')
    .insert([{ ...body, ref_number: refNumber, company, folder_path: folderPath }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id, ref_number: refNumber, folder_path: folderPath }, { status: 201 });
}

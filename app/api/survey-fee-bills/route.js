import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

async function generateBillNumber(company) {
  const { data } = await supabase
    .from('bill_counters')
    .select('counter_value')
    .eq('company', company)
    .single();
  const counter = (data?.counter_value || 0) + 1;
  await supabase
    .from('bill_counters')
    .update({ counter_value: counter })
    .eq('company', company);

  const prefix = company === 'NISLA' ? 'NISLA' : company === 'Acuere' ? 'ACU' : 'DEV';
  return `${prefix}/SF/${String(counter).padStart(4, '0')}/26-27`;
}

// GIPSA fee calculation logic
function calculateGIPSAFee(lob, lossAmount) {
  const amount = parseFloat(lossAmount) || 0;
  if (amount <= 0) return 0;

  // Standard GIPSA slab structure (same for Fire, Engineering, BI, Cat Event)
  const standardSlabs = [
    { min: 0, max: 100000, calc: () => 5000 },
    { min: 100001, max: 500000, calc: (a) => a * 0.05 },
    { min: 500001, max: 1000000, calc: (a) => 25000 + (a - 500000) * 0.03 },
    { min: 1000001, max: 5000000, calc: (a) => 40000 + (a - 1000000) * 0.02 },
    { min: 5000001, max: 10000000, calc: (a) => 120000 + (a - 5000000) * 0.015 },
    { min: 10000001, max: Infinity, calc: (a) => 195000 + (a - 10000000) * 0.01 },
  ];

  const marineSlabs = [
    { min: 0, max: 100000, calc: () => 3500 },
    { min: 100001, max: 500000, calc: (a) => a * 0.04 },
    { min: 500001, max: 1000000, calc: (a) => 20000 + (a - 500000) * 0.025 },
    { min: 1000001, max: 5000000, calc: (a) => 32500 + (a - 1000000) * 0.015 },
    { min: 5000001, max: Infinity, calc: (a) => 92500 + (a - 5000000) * 0.01 },
  ];

  const ewSlabs = [
    { min: 0, max: 50000, calc: () => 2500 },
    { min: 50001, max: 200000, calc: (a) => a * 0.04 },
    { min: 200001, max: 500000, calc: (a) => 8000 + (a - 200000) * 0.03 },
    { min: 500001, max: Infinity, calc: (a) => 17000 + (a - 500000) * 0.02 },
  ];

  const bankingSlabs = [
    { min: 0, max: 100000, calc: () => 3500 },
    { min: 100001, max: 500000, calc: (a) => a * 0.04 },
    { min: 500001, max: Infinity, calc: (a) => 20000 + (a - 500000) * 0.02 },
  ];

  const miscLiabilitySlabs = [
    { min: 0, max: 100000, calc: () => 5000 },
    { min: 100001, max: 500000, calc: (a) => a * 0.05 },
    { min: 500001, max: 1000000, calc: (a) => 25000 + (a - 500000) * 0.03 },
    { min: 1000001, max: Infinity, calc: (a) => 40000 + (a - 1000000) * 0.02 },
  ];

  let slabs;
  switch (lob) {
    case 'Marine Cargo': slabs = marineSlabs; break;
    case 'Extended Warranty': slabs = ewSlabs; break;
    case 'Banking': slabs = bankingSlabs; break;
    case 'Miscellaneous':
    case 'Liability':
    case 'Marine Hull': slabs = miscLiabilitySlabs; break;
    default: slabs = standardSlabs;
  }

  for (const slab of slabs) {
    if (amount >= slab.min && amount <= slab.max) {
      return Math.round(slab.calc(amount) * 100) / 100;
    }
  }
  return 0;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let query = supabase.from('survey_fee_bills').select('*').order('created_at', { ascending: false });

  const company = searchParams.get('company');
  if (company) query = query.eq('company', company);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request) {
  const body = await request.json();
  const company = body.company || 'NISLA';

  // Generate bill number
  const billNumber = await generateBillNumber(company);

  // Calculate fee
  let calculatedFee = 0;
  if (body.fee_type === 'Custom') {
    calculatedFee = parseFloat(body.calculated_fee) || 0;
  } else {
    calculatedFee = calculateGIPSAFee(body.lob, body.loss_amount);
  }

  const gstRate = parseFloat(body.gst_rate) || 18;
  const gstAmount = Math.round(calculatedFee * gstRate / 100 * 100) / 100;
  const totalAmount = calculatedFee + gstAmount;

  const record = {
    bill_number: billNumber,
    bill_date: body.bill_date || new Date().toISOString().split('T')[0],
    claim_id: body.claim_id || null,
    ref_number: body.ref_number || null,
    lob: body.lob,
    insured_name: body.insured_name,
    insurer_name: body.insurer_name,
    company,
    loss_amount: parseFloat(body.loss_amount) || 0,
    fee_type: body.fee_type || 'GIPSA',
    calculated_fee: calculatedFee,
    gst_rate: gstRate,
    gst_amount: gstAmount,
    total_amount: totalAmount,
    payment_status: 'Pending',
    remarks: body.remarks || null,
  };

  const { data, error } = await supabase.from('survey_fee_bills').insert([record]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Update claim with bill info if claim_id provided
  if (body.claim_id) {
    await supabase.from('claims').update({
      survey_fee_bill_number: billNumber,
      survey_fee_bill_date: record.bill_date,
      survey_fee_bill_amount: totalAmount,
    }).eq('id', body.claim_id);
  }

  return NextResponse.json(data, { status: 201 });
}

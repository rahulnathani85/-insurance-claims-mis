import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';
import { LOB_LIST, MARINE_CLIENTS, MARINE_CLIENT_FORMATS } from '@/lib/constants';

const UNIFIED_LOBS = ['Fire', 'Engineering', 'Business Interruption', 'Miscellaneous'];

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const filterLob = searchParams.get('lob');

  const structures = [];

  // Get all ref_counters
  const { data: counters } = await supabase.from('ref_counters').select('*').order('lob');
  const counterMap = {};
  (counters || []).forEach(c => { counterMap[c.lob] = c; });

  // Get marine_counters
  const { data: marineCounters } = await supabase.from('marine_counters').select('*');
  const marineMap = {};
  (marineCounters || []).forEach(c => { marineMap[c.client_category] = c; });

  const formatMap = {
    'Fire': '{counter}/YY-YY/Fire',
    'Engineering': '{counter}/YY-YY/Engg',
    'Extended Warranty': 'EW-{counter:04d}/YY-YY',
    'Business Interruption': '{counter}/YY-YY/BI',
    'Miscellaneous': '{counter}/YY-YY/Misc.',
    'Banking': 'INS-{counter:04d}/YY-YY',
    'Liability': '{counter}/YY-YY/LIABILITY',
    'Marine Hull': '{counter}/YY-YY/Hull',
    'Cat Event': '{counter}/YY-YY/CAT',
  };

  // Regular LOBs
  for (const lob of LOB_LIST) {
    if (lob === 'Marine Cargo') continue;
    if (filterLob && lob !== filterLob) continue;

    const isUnified = UNIFIED_LOBS.includes(lob);
    const counterKey = isUnified ? 'General' : lob;
    const counterData = counterMap[counterKey];
    const currentValue = counterData?.counter_value || 0;

    structures.push({
      id: `ref-${lob.replace(/\s+/g, '-').toLowerCase()}`,
      lob,
      format: formatMap[lob] || '{counter}/YY-YY/{LOB}',
      start_number: isUnified ? 3 : 0,
      current_number: currentValue,
      description: isUnified ? `Shared General counter (Fire/Engg/BI/Misc)` : `${lob} counter`,
    });
  }

  // Marine Cargo - generic Marine counter
  if (!filterLob || filterLob === 'Marine Cargo') {
    const marineCounter = counterMap['Marine'];
    structures.push({
      id: 'ref-marine-generic',
      lob: 'Marine Cargo',
      format: '{counter}/YY-YY/Marine',
      start_number: 4000,
      current_number: marineCounter?.counter_value || 4000,
      description: 'Generic Marine (Others Domestic/Import)',
    });

    // Marine Cargo - named clients
    for (const client of MARINE_CLIENTS) {
      if (client === 'Others Domestic' || client === 'Others Import') continue;
      const mc = marineMap[client];
      const code = MARINE_CLIENT_FORMATS[client] || 'UNKNOWN';
      structures.push({
        id: `ref-marine-${client.replace(/\s+/g, '-').toLowerCase()}`,
        lob: 'Marine Cargo',
        format: `${code}-{counter:03d}/YY-YY`,
        start_number: 0,
        current_number: mc?.counter_value || 0,
        description: `Marine Cargo - ${client}`,
      });
    }
  }

  return NextResponse.json(structures);
}

export async function POST(request) {
  const body = await request.json();
  if (!body.lob || !body.format) {
    return NextResponse.json({ error: 'LOB and Format are required' }, { status: 400 });
  }
  // For now, ref structures are read-only (derived from counters)
  return NextResponse.json({ error: 'Reference structures are managed automatically' }, { status: 400 });
}

export async function PUT(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });
  // Ref structures are read-only
  return NextResponse.json({ error: 'Reference structures are managed automatically' }, { status: 400 });
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });
  // Ref structures are read-only
  return NextResponse.json({ error: 'Reference structures cannot be deleted' }, { status: 400 });
}

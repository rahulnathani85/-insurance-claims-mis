import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';
import { LOB_LIST, MARINE_CLIENTS, MARINE_CLIENT_FORMATS } from '@/lib/constants';

export async function GET() {
  const structures = [];

  for (const lob of LOB_LIST) {
    if (lob === 'Marine Cargo') continue;
    const { data } = await supabase.from('ref_counters').select('counter_value').eq('lob', lob).single();
    const counter = data?.counter_value || 0;

    const formatMap = {
      'Fire': { fmt: '{counter}/YY-YY/Fire', example: `${counter+1}/26-27/Fire`, start: 3000 },
      'Engineering': { fmt: '{counter}/YY-YY/Engg', example: `${counter+1}/26-27/Engg`, start: 3000 },
      'Extended Warranty': { fmt: 'EW-{counter:04d}/YY-YY', example: `EW-${String(counter+1).padStart(4,'0')}/26-27`, start: 0 },
      'Business Interruption': { fmt: '{counter}/YY-YY/BI', example: `${counter+1}/26-27/BI`, start: 3000 },
      'Miscellaneous': { fmt: '{counter}/YY-YY/Misc.', example: `${counter+1}/26-27/Misc.`, start: 3000 },
      'Banking': { fmt: 'INS-{counter:04d}/YY-YY', example: `INS-${String(counter+1).padStart(4,'0')}/26-27`, start: 0 },
      'Liability': { fmt: '{counter}/YY-YY/LIABILITY', example: `${counter+1}/26-27/LIABILITY`, start: 3000 },
      'Marine Hull': { fmt: '{counter}/YY-YY/Hull', example: `${counter+1}/26-27/Hull`, start: 3000 },
      'Cat Event': { fmt: '{counter}/YY-YY/CAT', example: `${counter+1}/26-27/CAT`, start: 5000 },
    };

    const info = formatMap[lob] || { fmt: '{counter}/YY-YY/{LOB}', example: `${counter+1}/26-27/${lob}`, start: 0 };
    structures.push({ lob, format: info.fmt, current_counter: counter, start_counter: info.start, next_ref: info.example, type: 'regular' });
  }

  // Marine generic counter (Others Domestic/Import)
  const { data: marineData } = await supabase.from('ref_counters').select('counter_value').eq('lob', 'Marine').single();
  const marineCounter = marineData?.counter_value || 4000;
  structures.push({
    lob: 'Marine Cargo',
    client_category: 'Generic',
    format: '{counter}/YY-YY/Marine',
    current_counter: marineCounter,
    start_counter: 4000,
    next_ref: `${marineCounter+1}/26-27/Marine`,
    type: 'marine'
  });

  // Marine named client categories
  for (const client of MARINE_CLIENTS) {
    if (client === 'Others Domestic' || client === 'Others Import') continue;
    const { data } = await supabase.from('marine_counters').select('counter_value').eq('client_category', client).single();
    const counter = data?.counter_value || 0;
    const code = MARINE_CLIENT_FORMATS[client] || 'UNKNOWN';

    structures.push({
      lob: 'Marine Cargo',
      client_category: client,
      format: `${code}-{counter:03d}/YY-YY`,
      current_counter: counter,
      start_counter: 0,
      next_ref: `${code}-${String(counter+1).padStart(3,'0')}/26-27`,
      type: 'marine'
    });
  }

  return NextResponse.json(structures);
}

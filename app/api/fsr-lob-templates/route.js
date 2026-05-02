// =============================================================================
// /api/fsr-lob-templates
// =============================================================================
// Read-only listing of fsr_lob_templates rows for the FSR-render UI's
// template-name dropdown. Filters by company + lob; collapses to the
// active rows + the latest version per (company, lob, template_name).
//
// Different from /api/fsr-templates (singular) which queries the older
// EW-shaped `fsr_templates` table — that one stays around for the EW
// FSR generator.
//
// Query params:
//   company     'NISLA' | 'Acuere'           required
//   lob         'Fire' | 'Marine Cargo' | 'Extended Warranty' | ...   required
//   includeAll  when 'true', include inactive + older versions too
//               (defaults to false — UI only wants the picker shortlist)
//
// Response: array of { id, company, lob, template_name, version, notes,
//                      is_active, updated_at }
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company');
  const lob = searchParams.get('lob');
  const includeAll = searchParams.get('includeAll') === 'true';

  let q = supabaseAdmin
    .from('fsr_lob_templates')
    .select('id, company, lob, template_name, version, notes, is_active, updated_at')
    .order('template_name', { ascending: true })
    .order('version', { ascending: false });

  if (company) q = q.eq('company', company);
  if (lob) q = q.eq('lob', lob);
  if (!includeAll) q = q.eq('is_active', true);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Collapse to the latest version per (company, lob, template_name)
  // unless the caller asked for the full list.
  const rows = data || [];
  if (includeAll) return NextResponse.json(rows);

  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = `${r.company}|${r.lob}|${r.template_name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return NextResponse.json(out);
}

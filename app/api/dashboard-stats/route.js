import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company');
  const isAll = !company || company === 'All';

  let baseQuery = () => {
    let q = supabase.from('claims').select('*', { count: 'exact', head: true });
    if (!isAll) q = q.eq('company', company);
    if (isAll) q = q.neq('company', 'Development');
    return q;
  };

  const { count: total } = await baseQuery();
  const { count: open } = await baseQuery().eq('status', 'Open');
  const { count: inProcess } = await baseQuery().eq('status', 'In Process');
  const { count: submitted } = await baseQuery().eq('status', 'Submitted');

  // LOB distribution
  let lobQuery = supabase.from('claims').select('lob');
  if (!isAll) lobQuery = lobQuery.eq('company', company);
  if (isAll) lobQuery = lobQuery.neq('company', 'Development');
  const { data: claims } = await lobQuery;
  const lobCounts = {};
  (claims || []).forEach(c => { lobCounts[c.lob] = (lobCounts[c.lob] || 0) + 1; });
  const lob_distribution = Object.entries(lobCounts)
    .map(([lob, count]) => ({ lob, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    total_claims: total || 0,
    open_claims: open || 0,
    in_process_claims: inProcess || 0,
    submitted_claims: submitted || 0,
    lob_distribution
  });
}

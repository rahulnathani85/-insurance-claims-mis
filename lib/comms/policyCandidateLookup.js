// =============================================================================
// lib/comms/policyCandidateLookup.js
// =============================================================================
// Deterministic candidate-policy lookup for the Policy Registration Agent.
// Returns up to 5 rows from the `policies` master that the agent should
// consider. Pure code — no LLM, no judgement. The agent then decides which
// (if any) candidate matches.
//
// Ranking strategy:
//   1. Exact policy_number match (uppercase, whitespace-stripped) within
//      the same company — strongest signal. Up to 3 such rows.
//   2. OCR-fuzzy policy_number match (O↔0, I↔1, dash/space variants) —
//      up to 2 more rows.
//   3. Insurer + insured_name fuzzy match (when policy_number is missing
//      or didn't yield exact hits) — fills remaining slots, capped at 5.
//
// All filters scoped by company so NISLA / ACUERE don't bleed into each
// other.
//
// Each returned row has the full master fields the prompt expects, plus
// a synthesised `verified` boolean (`coverage_amount IS NOT NULL AND
// start_date IS NOT NULL AND end_date IS NOT NULL`) since the live
// schema doesn't have an explicit verified column today. The agent
// uses verified=true as a tiebreaker when ranking equally-strong
// candidates.
// =============================================================================

const ILLEGAL_TRIM = /^[-\s]+|[-\s]+$/g;

// OCR-style normalisation: uppercase, strip whitespace + dashes, replace
// O→0 and I→1 to neutralise the most common OCR error pattern. Used to
// generate fuzzy-match keys, not to mutate stored data.
export function normalisePolicyNumber(s) {
  if (typeof s !== 'string') return '';
  let v = s.trim().toUpperCase().replace(/\s+/g, '').replace(ILLEGAL_TRIM, '');
  // Dashes are common; collapse runs to single dash.
  v = v.replace(/-{2,}/g, '-');
  return v;
}

function ocrFuzzyKey(s) {
  return normalisePolicyNumber(s).replace(/O/g, '0').replace(/I/g, '1').replace(/-/g, '');
}

function synthesiseVerified(row) {
  const hasAmount = row.coverage_amount != null
    || (typeof row.sum_insured === 'string' && row.sum_insured.trim() !== '');
  const hasStart  = !!row.start_date;
  const hasEnd    = !!row.end_date;
  return hasAmount && hasStart && hasEnd;
}

// ------------------------------------------------------------
// findCandidatePolicies({ supabase, policyNumber, insurer,
//                         insuredName, company })
//
// Returns: array of policy rows (max 5), in ranked order, each row
// shaped as the agent's `candidate_matches[i]`:
//   { id, policy_number, insurer, insurer_office, insured_name,
//     insured_address, phone, email, lob, policy_type, sum_insured,
//     premium, start_date, end_date, policy_copy_url, company,
//     created_at, source: 'master', verified: <synth boolean> }
// ------------------------------------------------------------
export async function findCandidatePolicies({
  supabase,
  policyNumber,
  insurer,
  insuredName,
  company,
} = {}) {
  if (!supabase) throw new Error('findCandidatePolicies: supabase client required');

  const collected = new Map();   // id -> row, dedup across the 3 passes
  const MAX = 5;

  const addRows = (rows, capForThisPass) => {
    if (!Array.isArray(rows)) return;
    let added = 0;
    for (const row of rows) {
      if (collected.has(row.id)) continue;
      collected.set(row.id, {
        ...row,
        source: 'master',
        verified: synthesiseVerified(row),
      });
      added += 1;
      if (added >= capForThisPass) break;
      if (collected.size >= MAX) break;
    }
  };

  const SELECT = `id, policy_number, insurer, insurer_office, insured_name,
    insured_address, phone, email, lob, policy_type, sum_insured, premium,
    start_date, end_date, policy_copy_url, company, coverage_amount, created_at`;

  // ---- Pass 1: exact match on normalised policy_number ----
  // Postgres ilike is case-insensitive but doesn't strip whitespace; we
  // normalise client-side and round-trip the candidates' values to compare.
  const normInput = normalisePolicyNumber(policyNumber);
  if (normInput) {
    let q = supabase.from('policies').select(SELECT).limit(20);
    if (company) q = q.eq('company', company);
    // Pull a slightly broader set then filter client-side because the
    // master may store policy numbers with stray whitespace / dashes.
    q = q.ilike('policy_number', `%${policyNumber.trim()}%`);
    const { data, error } = await q;
    if (!error && Array.isArray(data)) {
      const exact = data.filter((r) => normalisePolicyNumber(r.policy_number) === normInput);
      addRows(exact, 3);
    }
  }

  // ---- Pass 2: OCR-fuzzy policy_number match ----
  if (collected.size < MAX && normInput) {
    const fuzzyKey = ocrFuzzyKey(policyNumber);
    // Cheap heuristic: pull policies for this company whose normalised
    // form's fuzzy key matches. The DB doesn't have a fuzzy-key index,
    // so we limit to a sane page and filter client-side.
    let q = supabase.from('policies').select(SELECT).limit(50);
    if (company) q = q.eq('company', company);
    if (insurer) q = q.ilike('insurer', `%${String(insurer).slice(0, 12)}%`);
    const { data, error } = await q;
    if (!error && Array.isArray(data)) {
      const fuzzy = data.filter((r) =>
        ocrFuzzyKey(r.policy_number) === fuzzyKey
        && normalisePolicyNumber(r.policy_number) !== normInput  // exclude pass-1 hits
      );
      addRows(fuzzy, 2);
    }
  }

  // ---- Pass 3: insurer + insured_name fallback ----
  if (collected.size < MAX && (insurer || insuredName)) {
    let q = supabase.from('policies').select(SELECT).limit(20);
    if (company) q = q.eq('company', company);
    if (insurer)     q = q.ilike('insurer',     `%${String(insurer).slice(0, 24)}%`);
    if (insuredName) q = q.ilike('insured_name', `%${String(insuredName).slice(0, 24)}%`);
    const { data, error } = await q;
    if (!error && Array.isArray(data)) {
      addRows(data, MAX - collected.size);
    }
  }

  return Array.from(collected.values()).slice(0, MAX);
}

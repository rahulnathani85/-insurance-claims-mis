// ============================================================
// /api/communications/claim-search
// ------------------------------------------------------------
// Read-only typeahead helper for the comms-review "tag to
// existing claim by reference #" picker. Lets the clerk pick a
// real claim instead of typing a ref by hand (typo → 404).
//
// GET ?q=<text>&company=<NISLA|Acuere|...>&limit=25
//
// Behaviour:
//   - q empty            → most recent 25 claims for the scope
//   - q non-empty        → ILIKE OR across ref_number,
//                          claim_number, insured_name,
//                          policy_number (≤25 rows)
//   - company scoping    → mirrors /api/communications/review:
//                          users on company='all' / 'development'
//                          can pass an explicit ?company= param;
//                          others are pinned to their own company.
//
// Returns a compact projection (no full claim payload — the only
// caller is a dropdown render).
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

// PostgREST .or() uses commas as filter separators — a comma in
// the query string would inject a second predicate. Parentheses
// can short-circuit the AND/OR grouping. Strip both. Percent and
// underscore stay (they're SQL ILIKE wildcards, but a user typing
// them gets the wider match they implicitly asked for).
function sanitiseQuery(raw) {
    if (!raw) return '';
    return String(raw).trim().replace(/[,()]/g, ' ').slice(0, 80);
}

export async function GET(request) {
    const gate = await requireUser(request);
    if (gate.errorResponse) return gate.errorResponse;
    const user = gate.user;

    const { searchParams } = new URL(request.url);
    const q = sanitiseQuery(searchParams.get('q'));
    const companyParam = searchParams.get('company');
    const limitRaw = parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
    const limit = Math.min(Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT), MAX_LIMIT);

    // Same multi-company gate as /api/communications/review.
    const userCompanyKey = String(user.company || '').toLowerCase();
    const isMultiCompany = ['all', 'development'].includes(userCompanyKey);
    const scopeCompany = isMultiCompany ? (companyParam || null) : user.company;

    let query = supabaseAdmin
        .from('claims')
        .select(
            'id, ref_number, claim_number, insured_name, insurer_name, ' +
            'lob, lob_subcategory, policy_number, status, phase, company, ' +
            'created_at'
        )
        // Phase 'registered' first so the dropdown buries unfinished
        // intimation rows. Within phase, most recent first.
        .order('phase', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);

    if (scopeCompany) query = query.eq('company', scopeCompany);

    if (q) {
        // PostgREST OR string. Escape backslashes since we control the
        // input (already sanitised) but stay defensive.
        const pat = q.replace(/\\/g, '\\\\');
        query = query.or(
            [
                `ref_number.ilike.%${pat}%`,
                `claim_number.ilike.%${pat}%`,
                `insured_name.ilike.%${pat}%`,
                `policy_number.ilike.%${pat}%`,
            ].join(',')
        );
    }

    const { data, error } = await query;
    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        ok: true,
        query: q,
        scope_company: scopeCompany || 'all',
        count: data?.length || 0,
        results: data || [],
    });
}

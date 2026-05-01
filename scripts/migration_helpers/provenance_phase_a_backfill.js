#!/usr/bin/env node
// =============================================================================
// scripts/migration_helpers/provenance_phase_a_backfill.js
// =============================================================================
// Phase A backfill (provenance-conflict-system-spec.md §10).
//
// For every existing claim, creates one claim_field_values row per field that
// has a non-null value on the claims table. source_type='migrated', is_current=true,
// extraction_confidence=null. Idempotent: skips claims that already have rows.
//
// Usage:
//   NEXT_PUBLIC_SUPABASE_URL=...    \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/migration_helpers/provenance_phase_a_backfill.js [--apply] [--limit=N]
//
// Default is dry-run.
//
// Strategy: for each backfill-eligible field, look up the column on claims;
// build a typed FieldValue via lib/provenance/values.js; insert with
// source_type='migrated' so the value is treated as "pre-provenance baseline"
// and Phase B dual-writes can supersede it cleanly.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { buildFieldValue } from '../../lib/provenance/values.js';

const apply = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(url, key);

// Map of (claims column → { field_name, kind, source_document_type }).
// source_document_type='migrated' tags the synthetic source so authority
// ranking treats these rows as the lowest-authority baseline (per the spec
// §10 phase A intent).
// Only columns that actually exist on the live claims table on NEW.
// Verified by probing /rest/v1/claims?select=id,<col>&limit=1.
//
// Excluded:
//   - sum_insured              lives on policies, not claims (joined via policy_number)
//   - claim_amount_intimated   not yet wired on the live schema
//   - peril_type               not yet on the live schema
// These three remain valid provenance "fields" for write paths that
// originate elsewhere (e.g. document ingestion pulling sum_insured from
// the policy schedule); they just have no backing column to backfill from.
const COLUMN_MAP = [
  { col: 'gross_loss',             field: 'gross_loss',             kind: 'money' },
  { col: 'estimated_loss_amount',  field: 'estimated_loss_amount',  kind: 'money' },
  { col: 'date_loss',              field: 'date_loss',              kind: 'date' },
  { col: 'date_of_intimation',     field: 'date_of_intimation',     kind: 'date' },
  { col: 'policy_period_from',     field: 'policy_period_from',     kind: 'date' },
  { col: 'policy_period_to',       field: 'policy_period_to',       kind: 'date' },
  { col: 'policy_number',          field: 'policy_number',          kind: 'string' },
  { col: 'insured_name',           field: 'insured_name',           kind: 'string' },
  { col: 'insurer_name',           field: 'insurer_name',           kind: 'string' },
  { col: 'lob',                    field: 'lob',                    kind: 'string' },
  { col: 'loss_location',          field: 'loss_location',          kind: 'string' },
];

async function main() {
  console.log(`[backfill] mode = ${apply ? 'APPLY' : 'DRY-RUN'}`);

  const cols = COLUMN_MAP.map((m) => m.col).join(', ');
  let q = supabase.from('claims').select(`id, ref_number, ${cols}`);
  if (limit) q = q.limit(limit);
  const { data: claims, error } = await q;
  if (error) { console.error('claims fetch failed:', error.message); process.exit(1); }

  let written = 0;
  let skipped = 0;
  let parseFails = 0;
  let claimsWithExisting = 0;

  for (const claim of claims) {
    // Skip claims that already have provenance rows (idempotency).
    const { count } = await supabase
      .from('claim_field_values')
      .select('id', { count: 'exact', head: true })
      .eq('claim_id', claim.id);
    if ((count || 0) > 0) {
      claimsWithExisting += 1;
      continue;
    }

    for (const { col, field, kind } of COLUMN_MAP) {
      const raw = claim[col];
      if (raw === null || raw === undefined || raw === '') continue;
      let typed;
      try {
        typed = buildFieldValue(kind, raw);
      } catch (e) {
        parseFails += 1;
        if (!apply) console.log(`  ! parse fail: claim ${claim.id} ${field}=${JSON.stringify(raw)}: ${e.message}`);
        continue;
      }

      const row = {
        claim_id: claim.id,
        field_name: field,
        value: typed.value,
        value_normalized: typed.normalized,
        source_type: 'migrated',
        source_document_type: 'migrated',
        source_label: `Pre-provenance migration (claims.${col})`,
        extracted_by: 'system:phase_a_backfill_v1',
        extraction_confidence: null,
        is_current: true,
        captured_by: null,
      };

      if (!apply) {
        skipped += 1;
        continue;
      }

      const { error: insErr } = await supabase.from('claim_field_values').insert([row]);
      if (insErr) {
        console.error(`  ! insert failed: claim ${claim.id} ${field}: ${insErr.message}`);
        continue;
      }
      written += 1;
    }
  }

  console.log('');
  console.log(`[backfill] claims processed = ${claims.length}`);
  console.log(`[backfill] claims with existing rows (skipped) = ${claimsWithExisting}`);
  console.log(`[backfill] rows written = ${written}`);
  console.log(`[backfill] rows that would be written (dry-run) = ${skipped}`);
  console.log(`[backfill] parse failures = ${parseFails}`);
  if (!apply) {
    console.log('[backfill] dry-run only. Re-run with --apply to write.');
  }
}

main().catch((e) => { console.error('[backfill] fatal:', e); process.exit(1); });

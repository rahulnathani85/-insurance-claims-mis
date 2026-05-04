// =============================================================================
// /api/offices/bulk-import
// =============================================================================
// POST multipart/form-data:
//   file        - .xlsx or .csv (required)
//   insurer_id  - BIGINT (required) — every row imports under this insurer
//   dry_run     - '1' to validate without writing (default '0')
//
// Required column header in the file:
//   office_code           one of HO/RO/LCBO/ZO/RCH/CCH/BO
//
// Optional columns (all matched case-insensitively, header row required):
//   name                  office name (defaults to office_code + ' Office'
//                         if missing, but a real name is strongly preferred)
//   parent_office_name    used to resolve parent_office_id. Looked up in:
//                           1. existing DB rows for this insurer
//                           2. earlier rows in the same import file (so a
//                              file can declare an HO at row 1 and an RO
//                              at row 2 that names that HO as parent)
//                         Hierarchy rule (lib/insurerOfficeTypes.isValidParent)
//                         is checked once the candidate parent is found.
//   address, city, state, pin, gstin, phone, email, contact_person,
//   office_short_code     direct passthrough.
//
// Response shape (also returned for dry runs):
//   { created: <int>, skipped: <int>, errors: [{row, message, ...}],
//     parent_links_resolved: <int>, dry_run: <bool> }
//
// Behaviour notes:
//   - HO singleton invariant is checked client-side and server-side: the
//     file may declare at most one HO per insurer (dedup), AND no HO may
//     conflict with an existing one in the DB.
//   - Two-pass insert: pass 1 inserts all parent-less rows (HO + any
//     unresolved-parent rows that would become orphans). Pass 2 inserts
//     children with their resolved parent_office_id. This handles the
//     forward-reference case where a file lists a child before its parent.
//   - On non-dry-run, partial failures don't roll back: rows that did
//     insert stay; failed rows are reported in `errors[]`. The clerk can
//     fix the file and re-import — upserts skip dupes by (insurer_id,
//     office_code, name).
// =============================================================================

import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  OFFICE_CODE_LIST,
  ALLOWED_PARENT_TYPES,
  isValidParent,
} from '@/lib/insurerOfficeTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Allow at most ~5000 rows per upload — anything larger is almost certainly
// a malformed file or someone trying to DoS the endpoint. Round number, well
// under serverless memory budget for parsed sheets.
const MAX_ROWS = 5000;

// ----- helpers ---------------------------------------------------------------

function trimOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function normaliseHeader(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, '_'); // "Office Code" / "Office-Code" → "office_code"
}

// Map a raw row (object keyed by lowercase header) to a clean shape.
function pickFields(rawRow) {
  const officeCodeRaw = String(rawRow.office_code || '').trim().toUpperCase();
  return {
    office_code: officeCodeRaw,
    name: trimOrNull(rawRow.name),
    parent_office_name: trimOrNull(rawRow.parent_office_name),
    address: trimOrNull(rawRow.address),
    city: trimOrNull(rawRow.city),
    state: trimOrNull(rawRow.state),
    pin: trimOrNull(rawRow.pin),
    gstin: trimOrNull(rawRow.gstin),
    phone: trimOrNull(rawRow.phone),
    email: trimOrNull(rawRow.email),
    contact_person: trimOrNull(rawRow.contact_person),
    office_short_code: trimOrNull(rawRow.office_short_code),
  };
}

// Read multipart form, return parsed rows + form values.
async function parseFormUpload(request) {
  const form = await request.formData();
  const file = form.get('file');
  const insurerIdRaw = form.get('insurer_id');
  const dryRunRaw = form.get('dry_run');

  if (!file || typeof file === 'string') {
    throw new Error('file is required (multipart field "file")');
  }
  if (!insurerIdRaw) {
    throw new Error('insurer_id is required');
  }
  const insurerId = Number.parseInt(String(insurerIdRaw), 10);
  if (!Number.isFinite(insurerId) || insurerId <= 0) {
    throw new Error('insurer_id must be a positive integer');
  }
  const dryRun = String(dryRunRaw || '0') === '1';

  const buf = Buffer.from(await file.arrayBuffer());
  // xlsx auto-detects xlsx/xls/csv from contents.
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) {
    throw new Error('uploaded file has no readable sheet');
  }
  // header:1 returns rows as arrays so we can normalise the header ourselves.
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (aoa.length < 2) {
    throw new Error('file must have a header row + at least one data row');
  }

  const headerRow = aoa[0].map(normaliseHeader);
  if (!headerRow.includes('office_code')) {
    throw new Error('header row must contain an "office_code" column');
  }

  const rows = [];
  for (let i = 1; i < aoa.length; i += 1) {
    const cells = aoa[i];
    // Skip fully empty rows.
    const hasAny = cells.some((c) => String(c ?? '').trim() !== '');
    if (!hasAny) continue;
    const rec = {};
    headerRow.forEach((h, idx) => {
      rec[h] = cells[idx];
    });
    rows.push({ rowNum: i + 1, raw: rec }); // rowNum is 1-based file row
  }
  if (rows.length === 0) {
    throw new Error('no data rows in file');
  }
  if (rows.length > MAX_ROWS) {
    throw new Error(`too many rows (${rows.length} > ${MAX_ROWS})`);
  }

  return { rows, insurerId, dryRun };
}

// ----- POST ------------------------------------------------------------------

export async function POST(request) {
  let parsed;
  try {
    parsed = await parseFormUpload(request);
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || 'failed to parse upload' },
      { status: 400 }
    );
  }
  const { rows, insurerId, dryRun } = parsed;

  // ----- 1. Pre-fetch existing offices for this insurer (for parent resolution) -----
  const { data: existing, error: exErr } = await supabaseAdmin
    .from('insurer_offices')
    .select('id, name, office_code')
    .eq('insurer_id', insurerId);

  if (exErr) {
    return NextResponse.json(
      { error: `failed to load existing offices: ${exErr.message}` },
      { status: 500 }
    );
  }

  // Index by name (case-insensitive) for parent lookup.
  const existingByName = new Map();
  for (const o of existing || []) {
    existingByName.set(String(o.name).toLowerCase(), o);
  }
  const existingHo = (existing || []).find((o) => o.office_code === 'HO');

  // ----- 2. First pass — validate every row, compute prelimMap (planned id allocation) -----
  // We also detect duplicate-HO conditions both within the file and against
  // the DB before doing any inserts.
  const errors = [];
  const planned = []; // { rowNum, fields, plannedKey, parentKey?, needsParent }
  const sawHo = new Set(); // local HO dedup within the file

  for (const { rowNum, raw } of rows) {
    const f = pickFields(raw);

    if (!OFFICE_CODE_LIST.includes(f.office_code)) {
      errors.push({
        row: rowNum,
        message: `invalid office_code "${f.office_code}" (must be one of ${OFFICE_CODE_LIST.join(', ')})`,
      });
      continue;
    }
    if (!f.name) {
      // Default to a stub if the clerk left it blank — but flag a warning row.
      f.name = `${f.office_code} Office (row ${rowNum})`;
      errors.push({
        row: rowNum,
        message: 'name was blank — used a stub. Edit after import.',
        warning: true,
      });
    }

    // HO-specific rules.
    if (f.office_code === 'HO') {
      if (sawHo.has(insurerId)) {
        errors.push({ row: rowNum, message: 'duplicate HO in file (only one HO per insurer)' });
        continue;
      }
      sawHo.add(insurerId);
      if (existingHo && String(existingHo.name).toLowerCase() !== f.name.toLowerCase()) {
        errors.push({
          row: rowNum,
          message: `insurer already has an HO ("${existingHo.name}") — file declares a different one ("${f.name}")`,
        });
        continue;
      }
      // HO must NOT have a parent.
      if (f.parent_office_name) {
        errors.push({
          row: rowNum,
          message: 'HO cannot have a parent_office_name — leave blank',
        });
        continue;
      }
    } else {
      // Non-HO rows must declare a parent we can resolve (either existing
      // in DB or earlier in the file).
      if (!f.parent_office_name) {
        // Allow if the only legal parent type is HO and the insurer has one
        // (fall back to the existing HO).
        const onlyParents = ALLOWED_PARENT_TYPES[f.office_code];
        const fallbackToHo =
          onlyParents.length === 1 &&
          onlyParents[0] === 'HO' &&
          existingHo;
        if (!fallbackToHo) {
          errors.push({
            row: rowNum,
            message: `${f.office_code} requires parent_office_name (legal parents: ${onlyParents.join(', ')})`,
          });
          continue;
        }
      }
    }

    planned.push({ rowNum, fields: f });
  }

  // ----- 3. Second pass — resolve parent_office_id and validate hierarchy -----
  // Build a "resolution table" that includes both DB rows and earlier
  // planned rows in this file (the latter without an id yet — they get
  // a placeholder id during dry runs / pass-1 inserts).
  const resolveMap = new Map(existingByName); // lowercase name → { id?, office_code }
  let parentLinksResolved = 0;
  const resolveErrors = [];

  for (const p of planned) {
    const f = p.fields;

    if (f.office_code === 'HO') {
      // No parent. If there's a pre-existing HO with the same name, reuse
      // that id during planning so children can resolve to it.
      const existingMatch = existingByName.get(f.name.toLowerCase());
      if (existingMatch) {
        resolveMap.set(f.name.toLowerCase(), {
          id: existingMatch.id,
          office_code: 'HO',
        });
      } else {
        // New HO — record by name without id yet (id gets filled after insert).
        resolveMap.set(f.name.toLowerCase(), { id: null, office_code: 'HO' });
      }
      p.parentLookup = null;
      continue;
    }

    // Parent name to resolve. Either explicit or fallback to existing HO.
    const lookupKey = (
      f.parent_office_name ||
      (existingHo ? existingHo.name : null)
    );
    if (!lookupKey) {
      resolveErrors.push({
        row: p.rowNum,
        message: `cannot resolve parent for ${f.office_code} (no parent_office_name and no HO exists)`,
      });
      continue;
    }
    const cand = resolveMap.get(lookupKey.toLowerCase());
    if (!cand) {
      resolveErrors.push({
        row: p.rowNum,
        message: `parent "${lookupKey}" not found (must exist in DB or appear earlier in file)`,
      });
      continue;
    }
    if (!isValidParent(f.office_code, cand.office_code)) {
      resolveErrors.push({
        row: p.rowNum,
        message: `${f.office_code} cannot have a ${cand.office_code} parent (legal parents: ${ALLOWED_PARENT_TYPES[f.office_code].join(', ')})`,
      });
      continue;
    }
    p.parentLookup = lookupKey.toLowerCase();
    if (cand.id != null) parentLinksResolved += 1;

    // Record this row in the resolveMap so later rows can name it as a parent.
    resolveMap.set(f.name.toLowerCase(), { id: null, office_code: f.office_code });
  }

  errors.push(...resolveErrors);

  // ----- 4. Dry run: stop here -----
  if (dryRun) {
    const fatal = errors.filter((e) => !e.warning).length;
    return NextResponse.json({
      dry_run: true,
      created: 0,
      skipped: planned.length - fatal,
      errors,
      parent_links_resolved: parentLinksResolved,
    });
  }

  // ----- 5. Two-pass insert ---------------------------------------------------
  // Pass A: rows whose parent is already in the DB (or HO with no parent).
  //         These can insert immediately. After insertion their generated id
  //         lands in the resolveMap so Pass B can reference them.
  // Pass B: rows whose parent was an earlier-in-file row (now has an id from
  //         Pass A). We may need multiple iterations for chains.

  let created = 0;
  let skippedDupe = 0;

  // Lookup table keyed by lowercase name, value = id (filled as we insert).
  // Seed from existingByName.
  const idByName = new Map();
  for (const o of existing || []) idByName.set(String(o.name).toLowerCase(), o.id);

  const queue = planned
    .filter((p) => !errors.find((e) => e.row === p.rowNum && !e.warning))
    .slice(); // shallow copy

  // We loop until either the queue is empty or no row made progress in a pass
  // (which would indicate a circular reference — caught and reported).
  while (queue.length > 0) {
    const passSize = queue.length;
    let progressed = false;

    for (let i = queue.length - 1; i >= 0; i -= 1) {
      const p = queue[i];
      const f = p.fields;

      let parentId = null;
      if (f.office_code !== 'HO') {
        const lookupKey =
          p.parentLookup ||
          (existingHo ? existingHo.name.toLowerCase() : null);
        if (!lookupKey) continue;
        if (!idByName.has(lookupKey)) continue; // parent not yet inserted; try next pass
        parentId = idByName.get(lookupKey);
      }

      // Idempotency: skip if (insurer_id, office_code, name) already exists.
      const existingMatch = (existing || []).find(
        (o) =>
          o.office_code === f.office_code &&
          String(o.name).toLowerCase() === f.name.toLowerCase()
      );
      if (existingMatch) {
        idByName.set(f.name.toLowerCase(), existingMatch.id);
        skippedDupe += 1;
        queue.splice(i, 1);
        progressed = true;
        continue;
      }

      const insertRow = {
        insurer_id: insurerId,
        office_code: f.office_code,
        parent_office_id: parentId,
        name: f.name,
        address: f.address,
        city: f.city,
        state: f.state,
        pin: f.pin,
        gstin: f.gstin,
        phone: f.phone,
        email: f.email,
        contact_person: f.contact_person,
        office_short_code: f.office_short_code,
        is_active: true,
      };

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('insurer_offices')
        .insert([insertRow])
        .select('id')
        .single();

      if (insErr || !inserted) {
        errors.push({
          row: p.rowNum,
          message: `insert failed: ${insErr?.message || 'unknown'}`,
        });
        queue.splice(i, 1);
        progressed = true;
        continue;
      }

      idByName.set(f.name.toLowerCase(), inserted.id);
      created += 1;
      queue.splice(i, 1);
      progressed = true;
    }

    if (!progressed) {
      // The remaining queue items all reference a parent that doesn't exist
      // (likely a typo or circular ref). Surface them as errors and stop.
      for (const p of queue) {
        errors.push({
          row: p.rowNum,
          message: `parent "${p.parentLookup}" never resolved (typo or circular reference)`,
        });
      }
      break;
    }
    // Defensive guard — passSize should strictly decrease each loop.
    if (queue.length >= passSize) break;
  }

  return NextResponse.json({
    dry_run: false,
    created,
    skipped: skippedDupe,
    errors,
    parent_links_resolved: parentLinksResolved,
  });
}

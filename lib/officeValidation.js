// =============================================================================
// lib/officeValidation.js
// =============================================================================
// Server-side validation + hydration for the 3-office insurer model
// (appointing / policy / fsr). Used by:
//   - POST /api/claims        (initial create)
//   - PUT  /api/claims/[id]   (edit)
//
// What it enforces (per the picker spec):
//   1. Each provided *_office_id refers to an existing insurer_offices row.
//   2. The office is is_active=true (no FK to inactive offices on new writes).
//   3. All three offices belong to the SAME insurer — either the one resolved
//      from body.insurer_name (claims has no insurer_id column today, so we
//      look up by company_name), or, if no insurer_name is given, the insurer
//      of the first provided office is taken as the source of truth.
//
// What it hydrates:
//   For each role that came in with a non-null *_office_id, we OVERWRITE the
//   *_office_name and *_office_address fields on the body from the office row.
//   This is deliberate: the client is not trusted to supply correct labels;
//   the FK is the source of truth (CLAUDE.md §17 "Don't trust insurer-provided
//   ... numbers" generalised).
//
// Returns:
//   { ok: true,  body }                  — validation passed; body mutated in place
//   { ok: false, status, error }         — 400-class error to surface to caller
// =============================================================================

const ROLES = ['appointing', 'policy', 'fsr'];

export async function validateAndHydrateOffices(supabaseAdmin, body) {
  if (!body || typeof body !== 'object') return { ok: true, body };

  const provided = ROLES.filter((r) => {
    const v = body[`${r}_office_id`];
    return v !== null && v !== undefined && v !== '';
  });
  if (provided.length === 0) return { ok: true, body };

  // Resolve the claim's insurer_id from insurer_name. claims has no
  // insurer_id column (only insurer_name TEXT), so this is the closest we
  // get to a primary-key check. Case-insensitive compare to be lenient about
  // upstream data quality.
  let insurerId = null;
  if (body.insurer_name) {
    const { data: insurerRow, error: insurerLookupErr } = await supabaseAdmin
      .from('insurers')
      .select('id, company_name')
      .ilike('company_name', body.insurer_name.trim())
      .maybeSingle();
    if (insurerLookupErr) {
      return { ok: false, status: 500, error: insurerLookupErr.message };
    }
    insurerId = insurerRow?.id || null;
  }

  // One round-trip for all referenced offices. .in() with up to 3 ids.
  const ids = provided.map((r) => body[`${r}_office_id`]);
  const { data: offices, error: officeFetchErr } = await supabaseAdmin
    .from('insurer_offices')
    .select('id, insurer_id, name, address, city, state, pin, is_active')
    .in('id', ids);
  if (officeFetchErr) {
    return { ok: false, status: 500, error: officeFetchErr.message };
  }

  const byId = new Map();
  for (const o of offices || []) byId.set(Number(o.id), o);

  for (const role of provided) {
    const rawId = body[`${role}_office_id`];
    const id = Number(rawId);
    const o = byId.get(id);
    if (!o) {
      return {
        ok: false,
        status: 400,
        error: `${role}_office_id ${rawId} not found`,
      };
    }
    if (o.is_active === false) {
      return {
        ok: false,
        status: 400,
        error: `${role}_office_id ${rawId} is inactive — pick an active office`,
      };
    }
    if (insurerId == null) {
      // Fallback: caller didn't supply insurer_name. Adopt the first office's
      // insurer_id as the source of truth and require all others to match.
      insurerId = o.insurer_id;
    }
    if (Number(o.insurer_id) !== Number(insurerId)) {
      return {
        ok: false,
        status: 400,
        error: `${role}_office_id ${rawId} belongs to a different insurer than the rest of the claim`,
      };
    }

    // Hydrate. Overwrite anything the client sent — see header comment.
    body[`${role}_office_id`] = id;
    body[`${role}_office_name`] = o.name;
    body[`${role}_office_address`] = [o.address, o.city, o.state, o.pin]
      .filter(Boolean)
      .join(', ');
  }

  return { ok: true, body };
}

// Exported for direct unit testing of the role list without re-deriving it
// in tests.
export const OFFICE_ROLES = ROLES;

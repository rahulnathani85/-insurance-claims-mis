# Insurer-portal RLS — design + phased rollout

> CLAUDE.md §11 #8: "Insurer read-only portal via Supabase RLS — Phase 2."
>
> This doc defines the design and the safe-rollout plan.
>
> - Phase 1 scaffolding shipped in commit `34ff778` — column shape,
>   role enum, helper module, design freeze.
> - Phase 2 shipped in `0549a57` + `7de3d82` — login flow, dashboard,
>   claim detail, mutation guards.
> - **Phase 3a shipped in this batch** — session-claim helpers, RLS
>   policies on 4 priority tables (claims / claim_field_values /
>   claim_fsr_drafts / site_visit_photos), scoped Supabase client,
>   insurer-portal routes migrated. Long-tail tables enumerated in §
>   "Phase 3b — long-tail tables" below.
> - Phase 4 (drop permissive baselines on the long tail) deferred.
>
> **Last updated:** 3 May 2026 (Phase 3a)

---

## Why we need this

Today the portal serves only NISLA + Acuere internal users. Insurers
(New India, Oriental, National, United India, plus private insurers
like ICICI Lombard / HDFC Ergo) communicate via email — they have no
self-serve view of the claims we're handling for them.

The Phase 2 deliverable is a **read-only insurer dashboard** at
`/insurer-portal/<insurer_id>` (or via a tenant-aware login) where an
insurer's claims dealing officer can:

- See the list of claims our firm is handling for *their* insurer
  (filter to their company; never see another insurer's pipeline).
- Drill into a single claim → see status, current FSR draft (if
  approved), submitted ILA, key dates, assigned surveyor.
- Download the FSR PDF when the surveyor has signed it.
- See no edit affordances. No mutation endpoints visible.

**Why RLS, not user-space filtering?** Defence in depth. If a
mutation endpoint accidentally leaks (or a surveyor's misconfigured
JWT scopes wider than intended), the database refuses the read
rather than the API route. Once the audit + Phase 3 land, even an
exfiltration attempt via `supabaseAdmin` from a hijacked insurer
session can't see another insurer's data.

---

## Current state (pre-Phase-1)

| Layer | State |
|---|---|
| Auth | Custom — `app_users` table + sessionStorage. No JWT. Login at `/api/auth/login`. |
| Roles | Free-text `role` column on `app_users`. Values seen in production: `Admin`, `Manager`, `Surveyor`, `Co-Surveyor`, `Engineer`, `CA`, `Inward Clerk`, `Staff`, `Read Only`. |
| RLS | Permissive `USING (true) WITH CHECK (true)` on every table. Tightening is a separate cross-cutting cleanup (CLAUDE.md §9). |
| Insurer linkage | None. There's an `insurers` table but no link from a user to an insurer row. |
| Server-side enforcement | Spotty. Most API routes accept any logged-in user. Some check `user.role` on the frontend only, which is bypassable. |

---

## Phase 1 — scaffolding (THIS MIGRATION)

Lands in `20260503030000_insurer_portal_scaffolding.sql` + `lib/auth/insurer.js`. **No behavioural change for existing users.**

### Schema additions

```sql
ALTER TABLE app_users
    ADD COLUMN insurer_id BIGINT REFERENCES insurers(id);

ALTER TABLE app_users
    ADD CONSTRAINT app_users_role_check
    CHECK (role IN ('Admin', 'Manager', 'Surveyor', 'Co-Surveyor',
                    'Engineer', 'CA', 'Inward Clerk', 'Staff',
                    'Read Only', 'insurer_readonly'));

ALTER TABLE app_users
    ADD CONSTRAINT app_users_insurer_role_pairing
    CHECK ((role = 'insurer_readonly' AND insurer_id IS NOT NULL) OR
           (role <> 'insurer_readonly' AND insurer_id IS NULL));
```

### Helper module

`lib/auth/insurer.js` exposes:

- `isInsurerUser(user)` → boolean
- `getInsurerId(user)` → BIGINT | null
- `requireSurveyorOrThrow(user)` → throws `INSURER_FORBIDDEN` 403 on insurer principal
- `scopeClaimsForInsurer(query, user)` → adds an `insurer_name` filter to a Supabase `from('claims')` query when the user is insurer-readonly; no-op otherwise
- `loadInsurer(user)` → fetches the insurer row by id

These are imported but not yet called by any route. Phase 2 wires them up.

### Acceptance criteria for Phase 1

- [x] Migration applies cleanly on the live `khtxngncvkwhoaybiigt` project
- [x] Existing surveyor login still works exactly as before
- [x] No claim / loss-sheet / FSR / chat route changes
- [x] `lib/auth/insurer.js` ships unused; future imports compile

---

## Phase 2 — login flow + insurer dashboard route (next slice)

### What changes

1. **Login route** (`app/api/auth/login/route.js`): when `app_users.role = 'insurer_readonly'`, the response includes `insurer_id` and `redirect_to: '/insurer-portal'`. The session shape gets `{ ..., insurer_id }` so client-side gating works.

2. **New page route** `/insurer-portal/page.js` — claim list filtered by `scopeClaimsForInsurer(query, user)`. No "Create claim" / "Edit" affordances.

3. **New page route** `/insurer-portal/claim/[id]/page.js` — claim detail (read-only). Reuses `<FieldWithProvenance>` for source visibility, the existing FSR preview, the ILA panel.

4. **Server-side gating on every claim mutation route** — call `requireSurveyorOrThrow(user)` at the top. If an insurer-readonly token leaks, mutations 403.

5. **Frontend route guard** — redirect non-insurer users away from `/insurer-portal/*`, redirect insurer users away from anything else.

### Acceptance criteria for Phase 2

- [ ] An admin can provision an insurer-readonly user via the user-management UI
- [ ] That user, after login, lands on `/insurer-portal` and sees only claims where `claims.insurer_name` matches their insurer
- [ ] Direct navigation to `/dashboard` / `/claim-detail/X` redirects them away
- [ ] Direct API calls to mutation routes (PUT / POST / DELETE) return 403
- [ ] Existing surveyor flows remain identical

### What does NOT change in Phase 2

- RLS stays permissive on the DB side. We rely on user-space gating. This means a hostile insurer user could in theory hit `supabaseAdmin` from a server route they shouldn't, but every server route is gated by `requireSurveyorOrThrow` so this only happens via a code review failure, not an authentication failure.

---

## Phase 3 — enable RLS

### Pre-flight checklist (must all be green before flipping)

1. Every API route that surveyors use is audited:
   - It accepts the session correctly.
   - It uses `supabaseAdmin` only when it has business reason (e.g. cron jobs, webhook handlers).
   - When it uses `supabase` (anon client) it relies on RLS for filtering.
2. Insurer dashboard pages have been live for ≥ 2 weeks with at least one real insurer user — to surface any "I can't see my own claim" bugs *before* RLS adds a second filter layer.
3. Insurer-only RLS policies are written for every claim-adjacent table:
   - `claims`
   - `claim_field_values` (provenance)
   - `claim_fsr_drafts`
   - `claim_documents`
   - `site_visits` + `site_visit_photos`
   - `marine_loss_sheets` + `marine_loss_sheet_items`
   - `loss_sheets` + `loss_sheet_items`
   - `claim_messages`, `claim_chat_messages`, `claim_ai_conversations`
   - `claim_issues`
   - `survey_fee_bills` (insurer can see invoice rows for their own claims)

### RLS policy pattern

```sql
-- Example: claims table — insurer users see only claims where
-- claims.insurer_name matches their insurer.
DROP POLICY IF EXISTS "Allow all access to claims" ON public.claims;

CREATE POLICY "claims_insurer_read" ON public.claims
    FOR SELECT
    USING (
        -- Surveyor-side users see everything (existing behaviour)
        current_setting('request.jwt.claims', true)::jsonb->>'role' <> 'insurer_readonly'
        OR
        -- Insurer-readonly users see only their own
        insurer_name = (
            SELECT name FROM public.insurers
             WHERE id = (current_setting('request.jwt.claims', true)::jsonb->>'insurer_id')::bigint
        )
    );

CREATE POLICY "claims_surveyor_write" ON public.claims
    FOR INSERT
    WITH CHECK (
        current_setting('request.jwt.claims', true)::jsonb->>'role' <> 'insurer_readonly'
    );

-- Similar UPDATE + DELETE policies, all gated against insurer_readonly.
```

### Migration shape

Each table gets one migration that drops the permissive policy and adds 4 new ones (SELECT for insurer + SELECT for surveyor + INSERT/UPDATE/DELETE for surveyor only). These are landed table-by-table over multiple deploys so a single break doesn't take the whole portal down.

### Rollback

If RLS breaks something, the rollback is per-table:

```sql
DROP POLICY IF EXISTS "claims_insurer_read" ON public.claims;
DROP POLICY IF EXISTS "claims_surveyor_write" ON public.claims;
CREATE POLICY "Allow all access to claims" ON public.claims
    USING (true) WITH CHECK (true);
```

This restores Phase 1/2 behaviour. Document each rollback alongside the forward migration.

---

## Phase 4 — drop permissive RLS

After Phase 3 has been live for 30 days clean (no production breaks
attributable to RLS changes), every remaining `Allow all access`
policy gets replaced with role-aware ones. This is the cleanup pass —
the actual security hardening already happened in Phase 3.

### Acceptance criteria

- [ ] Pen-test (manual, by sleep-deprived eyes is fine for now): try to read another insurer's claims via direct API calls, JWT manipulation, modifying request bodies. All should fail with 403 or empty results.
- [ ] CLAUDE.md §9 ("Role checks on every server action, default deny") flips from ⚠ to ✅.

---

## Open questions (resolve before Phase 2 starts)

1. **JWT or sessionStorage?** Current portal auth is sessionStorage-based.
   Phase 3 RLS uses `current_setting('request.jwt.claims', true)` which
   needs a real JWT. Options:
   - (a) Migrate auth to Supabase Auth + JWTs — bigger lift but matches RLS naturally.
   - (b) Keep custom auth, send the role + insurer_id as Postgres `SET LOCAL` from each API route — cheaper but requires every route to remember the SET.
   - (c) Use service-role for surveyor reads, anon-key + custom JWT for insurer reads — split-brain but minimises blast radius.
   **Recommendation:** (b) for Phase 2, evaluate (a) before Phase 3.

2. **Multi-insurer users?** Some clients are insurance brokers that
   represent multiple underwriters. Do they need access to multiple
   insurers' claims? If yes, schema needs `app_users_insurers`
   junction. If no, defer.
   **Default assumption:** no multi-insurer users in Phase 2. Treat
   broker case as Phase 5+.

3. **Sensitive data redaction?** Surveyors' internal notes (e.g.
   `narrative.observations` if it contains "insurer's claim
   processing has been slow") should not surface to the insurer.
   Decide:
   - Per-field redaction (e.g. an `insurer_visible BOOLEAN` column on `claim_fsr_drafts`).
   - Per-section redaction (only the FSR Final, never the working draft).
   **Default:** insurer sees only `claim_fsr_drafts` rows with `status = 'approved'`. Works-in-progress invisible.

4. **Cross-insurer claim handling.** Some catastrophes (CAT) involve
   multiple insurers on the same loss site. How do we handle
   per-claim insurer attribution? Out of scope for Phase 2; need a
   `claim_insurer_links` table eventually.

---

## File list (Phase 1 scaffolding commit `34ff778`)

- `supabase/migrations/20260503030000_insurer_portal_scaffolding.sql`
- `lib/auth/insurer.js`
- `docs/insurer-portal-rls-spec.md` (this file)

---

## Phase 3a — what shipped (this batch)

**Migrations:**

- `20260503040000_insurer_session_helpers.sql` — three SECURITY DEFINER
  functions:
  - `set_session_user(p_email TEXT)` — looks up `app_users` by email,
    sets the `app.user_email` / `app.user_role` /
    `app.user_insurer_id` GUCs at transaction-local scope, returns
    the role string (or NULL on unknown / inactive).
  - `current_user_role()` — read-side getter, returns NULL when no
    session has been established (e.g. service-role connections).
  - `current_user_insurer_id()` / `current_user_insurer_name()` —
    convenience getters used in policy bodies.
- `20260503050000_claims_rls.sql` — drops the permissive `Allow all
  access to claims` (and three other tables) and adds conditional RLS
  policies. Pattern:
  - `SELECT`: surveyor / staff / admin → permissive; insurer →
    scoped to `claims.insurer_name = current_user_insurer_name()`.
  - `INSERT/UPDATE/DELETE`: refused when
    `current_user_role() = 'insurer_readonly'`; permissive otherwise.

  Tables migrated:
  - `claims`
  - `claim_field_values` (provenance — scoped via parent claim)
  - `claim_fsr_drafts` (insurer sees only `status='approved'` rows)
  - `site_visit_photos` (scoped via parent claim)

**Server code:**

- `lib/supabaseScoped.js` — anon-key client wrapper. Calls
  `set_session_user(p_email)` at request start so subsequent SELECTs
  on the same client see the GUCs. Two helpers:
  - `scopedSupabaseFor({ email })` — returns `{ client, role, ok, error }`.
  - `scopedSupabaseFromRequest(request)` — pulls the email from the
    `X-User-Email` header (mirrors `requireSurveyorRequest`).
- Migrated routes: `/api/insurer-portal/claims` and
  `/api/insurer-portal/claims/[id]`. Both establish the scoped session
  before any claim-data SELECTs. Belt-and-braces user-space filters
  retained.

**Tests:**

- `tests/supabaseScoped.test.js` — 11 tests covering the wrapper's
  branching (empty email, RPC error, null role, success cases) and
  `scopedSupabaseFromRequest` header parsing.
- `tests/insurerAuth.test.js` from Phase 2 still passes (22 tests).
- Pre-existing `tests/executor.test.js` failures unchanged.

**Why surveyor flows are unaffected:**

- The portal's surveyor routes use `lib/supabaseAdmin` (service-role).
  Service-role bypasses RLS entirely. So the new policies are invisible
  to those routes.
- The handful of routes that use the anon-key `lib/supabase` client
  (`/api/auth/login`, surveyor lookups, etc.) don't call
  `set_session_user`, so `current_user_role()` returns NULL inside
  their RLS predicates — which falls into the permissive branch.
- The only routes that activate the restrictive predicates are the
  insurer-portal ones, where it's by design.

---

## Phase 3b — long-tail tables (deferred)

These tables were NOT migrated in Phase 3a. Each gets its own forward
+ rollback migration in subsequent slices. Listed in priority order:

| Table | Insurer-visible? | RLS policy strategy |
|---|---|---|
| `claim_messages` | ❌ No (internal NISLA chat) | Insurer SELECT refused; surveyor unrestricted |
| `claim_chat_messages` | ❌ No (internal AI co-pilot) | Same as above |
| `claim_ai_conversations` | ❌ No (global AI Analyst) | Same |
| `survey_fee_bills` | ❌ No (separate accounts flow) | Same |
| `marine_loss_sheets` + `_items` | ❌ No (working drafts) | Same |
| `loss_sheets` + `_items` | ❌ No (working drafts) | Same |
| `claim_documents` | 🟡 Partial — only docs linked to approved FSR | Per-row gate via parent claim + doc_type check |
| `site_visits` (header) | 🟡 Yes (timeline-only fields) | Scoped via parent claim |
| `claim_issues` | 🟡 Maybe (severity=error visible?) | Decision pending — deferred until insurer feedback |
| `ila_drafts` + `ila_submissions` | 🟡 Submitted ones only | Scoped via parent claim, status filter |

**Estimated effort:** 1-2 days for the full long-tail rollout (each
table ~20 lines of policy SQL + per-table rollback migration). Best
done after at least one real insurer user has been live on Phase 3a
for a week so any edge cases surface in production logs first.

---

## Phase 3a → 3b → 4 verification gates

Before promoting Phase 3b → Phase 4 (dropping the permissive baselines
on the long tail):

1. At least one real insurer user has logged into the portal and
   exercised the dashboard + claim-detail flows for ≥ 7 days
   without a "can't see my own claim" complaint.
2. A pen-test (deliberate misuse via direct API calls / JWT
   manipulation / body tampering) attempted from a non-portal client
   and verified to fail closed.
3. A cron-job that does a service-role read of `claims` confirmed
   still working (RLS bypass for service-role validated end-to-end).
4. Sentry / observability dashboard is clean of `INSURER_FORBIDDEN`
   error spikes — those would indicate a route doesn't yet pass the
   X-User-Email header.

---

Phase 4 — drop the remaining permissive `Allow all access` policies
across the long tail and replace with role-aware ones. Until then,
Phase 3a's defence-in-depth covers the highest-impact data surfaces.

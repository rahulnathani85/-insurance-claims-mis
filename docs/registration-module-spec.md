# Registration Module — Specification

> Status: Draft for build
> Owner: NISLA engineering
> Depends on: Inward module (✅ done), OCR + AI extraction (✅ done)
> Last updated: 2026-04-29

---

## 1. Purpose

Convert a categorised **intimation email** into a fully registered claim with a NISLA claim number, assigned surveyor(s), TAT timers running, and downstream automation triggered (acknowledgement to insurer, document checklist, surveyor notification).

This is the most-used screen in the portal. Speed and correctness here determine the whole pipeline.

---

## 2. Upstream Input (from Inward Module)

A categorised intimation arrives with:

- `email_id` — original email
- `email_thread_id` — for follow-ups on same claim
- Attachments stored in Supabase Storage with paths
- OCR text per attachment
- Claude Sonnet structured extraction:
  - `insurer_name`, `insurer_branch`, `dealing_officer_name`, `dealing_officer_email`
  - `policy_number`, `policy_period_from`, `policy_period_to`, `sum_insured`
  - `insured_name`, `insured_address`, `insured_contact`
  - `peril_hint` (best-guess peril type)
  - `date_of_loss`, `date_of_intimation`
  - `loss_location_address`, `loss_location_pin`
  - `preliminary_loss_estimate` (if mentioned)
  - `extraction_confidence` (per field, 0–1)

Pre-fill all of the above into the registration form. Show confidence as a colour cue (green ≥0.85, amber 0.6–0.85, red <0.6). Low-confidence fields must be touched by the clerk before submit.

---

## 3. Data Model

### `claims` (core)

```sql
CREATE TABLE claims (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_number                text UNIQUE NOT NULL,           -- NISLA-generated, see §5
  insurer_claim_number        text,                            -- as provided by insurer
  intimation_email_id         uuid REFERENCES inward_emails(id),

  -- Insurer
  insurer_id                  uuid REFERENCES insurers(id) NOT NULL,
  insurer_branch              text,
  dealing_officer_name        text,
  dealing_officer_email       text,
  dealing_officer_phone       text,

  -- Policy
  policy_number               text NOT NULL,
  policy_period_from          date NOT NULL,
  policy_period_to            date NOT NULL,
  sum_insured                 numeric(15,2) NOT NULL,
  policy_type                 text,                            -- e.g., "Standard Fire & Special Perils"

  -- Insured
  insured_name                text NOT NULL,
  insured_address             text,
  insured_contact_phone       text,
  insured_contact_email       text,
  insured_gstin               text,

  -- Loss
  peril_type                  peril_type_enum NOT NULL,        -- fire/marine_cargo/marine_hull/car/ear/cpm/mb/eei/...
  date_of_loss                date NOT NULL,
  date_of_intimation          date NOT NULL,
  date_of_assignment          date NOT NULL,                   -- defaults to today
  loss_location_address       text NOT NULL,
  loss_location_pin           text,
  loss_location_state         text,
  loss_location_district      text,
  loss_location_lat           numeric(9,6),
  loss_location_lng           numeric(9,6),
  preliminary_loss_estimate   numeric(15,2),
  claim_amount_intimated      numeric(15,2),

  -- Classification
  complexity_tier             complexity_enum NOT NULL,        -- small/standard/large/cat
  assignment_type             assignment_enum NOT NULL,        -- single/team
  is_catastrophe              boolean NOT NULL DEFAULT false,
  cat_event_id                uuid REFERENCES cat_events(id),  -- e.g., "Chennai Floods 2026"

  -- Fee
  fee_basis                   fee_basis_enum NOT NULL,         -- irdai_scale/special_agreement
  fee_amount                  numeric(15,2),
  fee_notes                   text,

  -- Workflow
  status                      claim_status_enum NOT NULL DEFAULT 'registered',
  ila_due_at                  timestamptz NOT NULL,            -- assignment + 72h
  fsr_due_at                  timestamptz NOT NULL,            -- per complexity tier
  
  -- Audit
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL REFERENCES users(id),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid NOT NULL REFERENCES users(id),
  deleted_at                  timestamptz
);
```

### `claim_assignments` (many-to-many, role-aware)

```sql
CREATE TABLE claim_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id        uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  role            assignment_role_enum NOT NULL,    -- lead_surveyor/co_surveyor/engineer/ca/observer
  scope           text,                              -- e.g., "BI computation", "civil works"
  conflict_declared boolean NOT NULL DEFAULT false,
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  assigned_by     uuid NOT NULL REFERENCES users(id),
  removed_at      timestamptz,
  removal_reason  text,
  UNIQUE (claim_id, user_id, role) WHERE removed_at IS NULL
);
```

A claim has exactly **one** active `lead_surveyor`. Validate in trigger.

### `claim_audit_log` (append-only)

```sql
CREATE TABLE claim_audit_log (
  id          bigserial PRIMARY KEY,
  claim_id    uuid NOT NULL REFERENCES claims(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  action      text NOT NULL,            -- created/field_updated/assigned/status_changed/document_added
  field_name  text,
  old_value   jsonb,
  new_value   jsonb,
  reason      text,                     -- required for backward state transitions
  ip_address  inet,
  user_agent  text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
```

No UPDATE or DELETE policies. Insert via DB trigger on `claims` and `claim_assignments`.

### Supporting tables (referenced)

- `insurers` — master list with branches, default dealing officers
- `cat_events` — catastrophe events with date range, region, fee adjustments
- `peril_metadata` — per peril: default complexity, document checklist template, FSR template
- `irdai_fee_scale` — current scale for auto-calc

---

## 4. Enums

```sql
CREATE TYPE peril_type_enum AS ENUM (
  'fire', 'marine_cargo', 'marine_hull',
  'car', 'ear', 'cpm', 'mb', 'eei',
  'bankers_indemnity', 'sports_media',
  'extended_warranty_vehicle', 'credit_upi',
  'liability_product_recall', 'business_interruption',
  'misc'
);

CREATE TYPE complexity_enum AS ENUM ('small', 'standard', 'large', 'cat');

CREATE TYPE assignment_enum AS ENUM ('single', 'team');

CREATE TYPE assignment_role_enum AS ENUM (
  'lead_surveyor', 'co_surveyor', 'engineer', 'ca', 'manager', 'observer'
);

CREATE TYPE fee_basis_enum AS ENUM ('irdai_scale', 'special_agreement');

CREATE TYPE claim_status_enum AS ENUM (
  'registered', 'ila_pending', 'ila_submitted',
  'documents_pending', 'investigation',
  'site_inspection_scheduled', 'site_inspection_done',
  'fsr_drafting', 'fsr_internal_review', 'fsr_submitted',
  'closed', 'reopened', 'withdrawn'
);
```

---

## 5. Claim Number Generation

Format: `<SEQ>/<FY>/<LOB>` — current production format, kept for backward compatibility with insurer-side records and existing 363+ claim references.

- `SEQ` — per-LOB-per-FY counter, no padding (e.g. `4053`)
- `FY` — financial year in `YY-YY` form (e.g. `26-27` for Apr 2026 – Mar 2027)
- `LOB` — full LOB name as used in the masters (`Fire`, `Marine Cargo`, `Engineering`, `Extended Warranty`, etc.)

Examples: `4053/26-27/Marine Cargo`, `237/26-27/Fire`, `AS-0080/26-27/Extended Warranty` (Acuere-prefixed for Extended Warranty under Acuere license).

Generation lives in `app/api/ref-structure/route.js` and `app/api/ref-numbers/route.js`, with per-LOB counter rows in `ref_counters`. Counters reset each financial year via the same admin route.

> **Aspiration (not currently implemented):** The original spec called for `NISLA/YYYY/<PERIL>/<REGION>/<SEQ>` (e.g. `NISLA/2026-27/FIR/WST/00237`) with PIN-derived region codes. We held off on the format change — too disruptive for in-flight claims and external references. Revisit when bandwidth allows.

---

## 6. Complexity Tier & TAT Logic

Auto-suggest on registration (clerk can override):

| Tier | Trigger | FSR TAT |
|---|---|---|
| `small` | Loss estimate < ₹1 lakh, single peril | 30 days |
| `standard` | ₹1L–₹50L | 30 days |
| `large` | ₹50L–₹5Cr or technical complexity | 45 days |
| `cat` | Linked to active `cat_event` OR > ₹5Cr | 90 days |

ILA TAT is always **72 hours** from `date_of_assignment`, regardless of tier.

Compute `ila_due_at` and `fsr_due_at` as IST business hours where the regulation allows; calendar hours otherwise. Default to calendar hours and document any deviation.

---

## 7. Surveyor Assignment Logic

Assignment is **mix** — single surveyor for small/standard, team for large/cat.

**Auto-suggestion at registration:**

1. **Single mode (default for small/standard):**
   - Filter surveyors by: licensed for `peril_type`, available in `region`, license not expiring within 30 days
   - Rank by: lowest current open-claim count, region match, past performance score
   - Suggest top 3, clerk picks one

2. **Team mode (default for large/cat, manual for others):**
   - Lead surveyor: same logic as single
   - Co-surveyor / engineer / CA: peril-driven defaults
     - Engineering perils (CAR/EAR/CPM/MB/EEI) → require engineer
     - BI claims → require CA
     - CAT claims → require manager observer
   - Clerk confirms each role

**Conflict check on assignment:**
- Compare assignee's declared conflicts (in user profile) against insurer + insured
- Block assignment if conflict exists, allow override with manager approval + audit reason

---

## 8. Form UX

### Layout

Three-column workspace:

```
[ Source pane ]    [ Registration form ]    [ AI suggestions ]
- Email body       - Insurer block          - Confidence cues
- Attachments      - Policy block           - Similar past claims
- OCR text         - Insured block          - Surveyor suggestions
                   - Loss block             - Checklist preview
                   - Classification
                   - Fee
                   - Assignment
```

### Behaviour

- Pre-fill from extraction; highlight low-confidence fields.
- Inline validation (Zod) — show errors as user types, not on submit.
- Save draft every 10 seconds (debounced) to `claim_drafts` table; restore on accidental close.
- "Show me past claims for this insured" — surfaces possible duplicates by name + policy + DoL within 7-day window.
- Submit button disabled until all mandatory fields validated AND surveyor assigned.
- After submit, navigate to claim detail page.

### Mandatory fields

`insurer_id, policy_number, policy_period_from, policy_period_to, sum_insured, insured_name, peril_type, date_of_loss, date_of_intimation, loss_location_address, loss_location_pin, complexity_tier, assignment_type, fee_basis, lead_surveyor (in claim_assignments)`

---

## 9. Server Action: `registerClaim`

```ts
// app/actions/registration/register-claim.ts

const RegisterClaimSchema = z.object({
  intimationEmailId: z.string().uuid(),
  insurerId: z.string().uuid(),
  insurerBranch: z.string().optional(),
  dealingOfficer: z.object({ name: z.string(), email: z.string().email(), phone: z.string().optional() }),
  policy: z.object({
    number: z.string().min(1),
    periodFrom: z.coerce.date(),
    periodTo: z.coerce.date(),
    sumInsured: z.number().positive(),
    type: z.string().optional(),
  }),
  insured: z.object({
    name: z.string().min(1),
    address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    gstin: z.string().optional(),
  }),
  loss: z.object({
    perilType: PerilEnum,
    dateOfLoss: z.coerce.date(),
    dateOfIntimation: z.coerce.date(),
    location: z.object({
      address: z.string().min(1),
      pin: z.string().regex(/^\d{6}$/),
      lat: z.number().optional(),
      lng: z.number().optional(),
    }),
    preliminaryEstimate: z.number().nonnegative().optional(),
    claimAmountIntimated: z.number().nonnegative().optional(),
  }),
  classification: z.object({
    complexityTier: ComplexityEnum,
    assignmentType: AssignmentEnum,
    isCatastrophe: z.boolean(),
    catEventId: z.string().uuid().optional(),
  }),
  fee: z.object({
    basis: FeeBasisEnum,
    amount: z.number().nonnegative().optional(),
    notes: z.string().optional(),
  }),
  assignments: z.array(z.object({
    userId: z.string().uuid(),
    role: AssignmentRoleEnum,
    scope: z.string().optional(),
    conflictDeclared: z.boolean(),
  })).min(1).refine(a => a.filter(x => x.role === 'lead_surveyor').length === 1, {
    message: 'Exactly one lead_surveyor required',
  }),
});
```

**Flow:**

1. Validate input (Zod).
2. Verify caller has `inward_clerk` or higher role (RLS + explicit check).
3. Check for duplicate (insurer + policy_number + date_of_loss exists?). If yes, return warning; require explicit override.
4. Begin transaction:
   a. Generate claim number (Postgres function).
   b. Compute `ila_due_at` (assignment + 72h) and `fsr_due_at` (per tier).
   c. Insert into `claims` with status = `registered`.
   d. Insert into `claim_assignments`.
   e. Update `inward_emails.linked_claim_id`.
5. Commit. (Audit log written by trigger.)
6. Enqueue Inngest jobs (outside txn):
   - Send acknowledgement to insurer dealing officer.
   - Send assignment notification to lead surveyor + team (email + WhatsApp).
   - Generate document checklist from `peril_metadata`.
   - Schedule ILA-due reminder (T-24h, T-6h, T+0).
7. Return `{ claimId, claimNumber }`.

---

## 10. Edge Cases

- **Duplicate intimation:** Same insurer + policy + DoL within 7 days → warning, manager override required.
- **Policy not in force:** `date_of_loss` outside policy period → block, allow override with manager approval + reason.
- **Future-dated loss:** Block.
- **Loss > 1 year old:** Warn (likely time-barred).
- **Sum insured = 0:** Block; require correction.
- **PIN not matching state/district:** Use India Post API; warn on mismatch.
- **Surveyor license expired:** Block assignment.
- **Insurer not in master:** Inline "create new insurer" flow (admin role only).
- **OCR extracted nothing useful:** Show empty form with raw email visible; clerk fills manually.

---

## 11. Notifications Triggered on Registration

| To | Channel | Content |
|---|---|---|
| Dealing officer (insurer) | Email | Assignment acknowledgement, NISLA claim number, lead surveyor contact |
| Lead surveyor | Email + WhatsApp | New assignment, claim summary, 72hr ILA due |
| Co-surveyor / engineer / CA | Email + WhatsApp | Role-specific brief |
| Internal manager (region) | Email | Daily digest of registrations |

All via Inngest queue. Failures retry; never block registration.

---

## 12. Acceptance Criteria

A registration is "done" when:

- [ ] Claim row exists with valid claim number.
- [ ] Lead surveyor assigned (exactly one).
- [ ] All mandatory fields populated and validated.
- [ ] `ila_due_at` and `fsr_due_at` computed correctly for tier.
- [ ] Audit log shows `created` entry plus one `assigned` per role.
- [ ] Inward email is linked to claim and removed from "to-register" queue.
- [ ] Acknowledgement email queued.
- [ ] Surveyor notifications queued.
- [ ] Document checklist generated from peril metadata.
- [ ] Status = `registered`, ready to transition to `ila_pending`.

---

## 13. Out of Scope (Phase 2+)

- Insurer self-service registration portal
- Insured login to upload documents
- Mobile-native registration (web responsive only for now)
- Auto-categorisation of inward emails (deliberately manual — see CLAUDE.md §4)
- Multi-currency claims (INR only for now)

---

## 14. Open Questions

1. ~~NISLA claim number format — confirm `NISLA/2026-27/FIR/WST/00237` matches existing convention or share current format.~~ **Resolved 29 Apr 2026:** keep existing `<SEQ>/<FY>/<LOB>` format (see §5).
2. Region master — current PIN-to-region mapping exists?
3. Surveyor performance score — how computed? (For ranking suggestions.)
4. Per-insurer dealing officer master — already maintained, or capture per claim?
5. WhatsApp provider — Interakt vs Gupshup vs MSG91 — has business chosen?

---

## 15. Implementation Notes (29 April 2026)

Adaptations made when actually building this module on the current stack (see `CLAUDE.md` §3 for the divergence). These notes are the **truth on the ground**; the sections above remain the original specification.

| Spec calls for | Actually implemented |
|---|---|
| `claims.id uuid` | `BIGSERIAL` — predates the spec, kept to avoid breaking existing references |
| `users` table | `app_users` table — same role |
| `inward_emails` table | `inbox_messages` table — Gmail integration |
| Dedicated `claim_audit_log` with JSONB `old_value`/`new_value` per field | Extended existing `activity_log` with `field_name` / `old_value` / `new_value` JSONB columns + Postgres trigger `trg_claims_audit` that auto-captures field diffs on every UPDATE to `claims` (see migration `20260429220000_registration_module_phase1.sql`) |
| Zod-validated server action `registerClaim` | API route `POST /api/claims/[id]/register/route.js` with hand-rolled JS validators in `lib/registration.js`. Vitest unit tests in `tests/registration.test.js`. |
| Inngest job queue for notifications | Not yet implemented — Vercel cron + future `notification_queue` table |
| WhatsApp + email notifications on registration | Not yet implemented — email-only planned via `notification_queue` |
| `peril_metadata` table for document checklist | Not yet implemented — checklist defaulting is hard-coded in `lib/lifecycleEngine.js` |
| Conflict-of-interest check on assignment | Not yet implemented — `surveyors` table exists but is not yet wired to assignments |

**What ships in slices A + B + C (29 Apr 2026):**

- ✅ §6 TAT computation: new columns `complexity_tier`, `ila_due_at`, `fsr_due_at`, `is_catastrophe`, `policy_period_from`, `policy_period_to` on `claims`. Auto-computed on registration based on loss amount + cat flag.
- ✅ §10 Validation gates: required fields (ref_number, policy_number, insured_name, lob), date_of_loss not in the future, date_of_loss within policy_period if set, > 1 year old → warning. All in `lib/registration.js`.
- ✅ §10 Duplicate detection: same insurer + policy + DoL within 7 days. Returns 422 + `duplicates: []` array; client can re-submit with `override_duplicate: true`.
- ✅ §3 Field-level audit: trigger `trg_claims_audit` writes one `activity_log` row per changed column on every claims UPDATE.

**Deferred for later slices:**

- ❌ §5 New claim # format (NISLA prefix + region) — out of scope; current SEQ/FY/LOB format retained.
- ❌ §7 Surveyor assignment ranking + conflict check — depends on `surveyors` table being wired up first.
- ❌ §8 Three-column registration UI rebuild — separate Slice E (~80 hours).
- ❌ §11 Notification queue — separate Slice G (~30 hours).

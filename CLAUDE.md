You are Claude Code working on NISLA's insurance surveyor portal.

# CLAUDE.md — NISLA ACUERE MIS Portal

> This file is the source of truth for Claude Code. Read it fully before any task. If a request conflicts with this file, ask before proceeding.
>
> **Last updated:** 29 April 2026 (post-Supabase migration; tech-stack section rewritten to match reality)

---

## 1. Business Context

**NISLA** (Nathani Insurance Surveyors & Loss Assessors Pvt. Ltd.) is an IRDAI-licensed Category-A / Fellow surveyor firm, established 1985, with PAN-India operations. We assess insurance losses on behalf of insurers — primarily PSU insurers (New India, Oriental, National, United India) and major private insurers.

**ACUERE Surveyors** is an IRDAI-licensed Category firm, established 2015, with PAN-India operations. Same business model, second licence — both entities operate through this single portal.

Our core deliverable is a **Final Survey Report (FSR)** that determines claim admissibility and quantum. Reports are regulatory documents subject to IRDAI scrutiny.

**Lines of business we handle:**
- Fire & Allied Perils
- Marine Cargo & Marine Hull
- Engineering (CAR / EAR / CPM / Machinery Breakdown)
- Electronic Equipment Insurance (EEI)
- Bankers Indemnity & Financial Losses
- Sports & Media
- Extended Warranty (Vehicle)
- Extended Warranty (Others)
- Credit / Debit / UPI Claims
- Liability & Product Recall
- Business Interruption
- Catastrophe & Large Losses (Chennai/Mumbai/Kerala/Ahmedabad/Punjab floods, Cyclones FENI/NISARGA)

---

## 2. What this project is

End-to-end claim management for NISLA's surveyors. The pipeline:

```
Email Inward → Manual Categorisation → Registration → ILA →
Document Collection → Site Inspection → Investigation →
FSR Drafting → Submission → Closure
```

**Scale:** ~500–1000 active claims/month, ~500 emails/day inward, PAN-India team of surveyors + engineers + CAs + managers.

**Users:** Internal only (Phase 1). No insurer or insured logins yet — they communicate via email.

**One-line goal:** Replace every manual intervention from intimation through closure with **dashboards** that cover the entire claim lifecycle.

**Primary user:** NISLA & ACUERE internal team (surveyors, engineers, CA team, branch coordinators, management)
**Secondary user (read-only views):** Insurers / TPAs as the portal matures (Phase 2).

**Target form factor:**
- Web-first, responsive (works on laptop + tablet at site)
- Eventual portable build (Tauri/Electron) for offline site work — **NOT yet built**

**LOBs defined by IRDAI handled by us (Phase 1):** Fire, Engineering, Marine Cargo, Marine Hull, Miscellaneous, LOP, etc.

---

## 3. Tech stack — actual reality

> The original spec called for a TypeScript / Prisma / NextAuth / monorepo / Tauri stack. We diverged. **This section reflects what's actually deployed at portal.nisla.in.** Don't propose changing the foundation lightly.

| Layer | What we use | Notes |
|---|---|---|
| Framework | **Next.js 14 (App Router)** | Pages in `app/`, API routes in `app/api/` |
| Language | **JavaScript (ES modules)** | NOT TypeScript. ~107 API routes, ~30 page folders, all `.js`. TS migration is a future cleanup, not blocking. |
| UI styling | **Plain CSS in `app/globals.css`** | Vanilla CSS, no Tailwind, no shadcn/ui. Inline `style={{}}` props are common. |
| Forms | Manual `useState` + controlled inputs | NO react-hook-form, NO zod. If touching forms, match existing pattern. |
| Server state | Direct `fetch()` from API routes | NO TanStack Query. SWR is also not used. |
| Backend | Next.js API routes (`app/api/<name>/route.js`) | Both `GET` and `POST` patterns in use. |
| Database | **Supabase Postgres** (project `khtxngncvkwhoaybiigt`, ap-south-1) | Connection via `@supabase/supabase-js`. Two clients: `lib/supabase.js` (anon) + `lib/supabaseAdmin.js` (service role). |
| ORM | **None — raw Supabase SDK** | `supabaseAdmin.from('claims').select(...)` everywhere. NO Prisma. SQL migrations live in `supabase/migrations/<14-digit-UTC>_<name>.sql`. |
| Auth | **Custom: `app_users` table + sessionStorage** | NOT NextAuth, NOT Supabase Auth. Login route at `app/api/auth/login/route.js`. ⚠ Passwords are stored as **plain text** in `app_users.password_hash` — security debt. |
| File storage | **Two backends in parallel:** Supabase Storage + a local file-server (`scripts/file-server/`) on `D:\2026-27\` | Supabase Storage for `claim-documents`. File-server for EW media + claim folders. Proxied via `/api/file-proxy`. |
| PDF generation | **Puppeteer server** (`scripts/puppeteer-server/`) — separate Node service | Renders HTML → PDF. Used for EW FSRs. Fire/Marine FSR templates are still hardcoded strings. |
| Email | **Gmail OAuth + Google Cloud Pub/Sub** | OAuth tokens in `gmail_tokens` table. Push via Pub/Sub topic. Polling via Vercel cron jobs (`/api/comms-cron/*`). |
| AI providers | **Anthropic SDK + `@google/generative-ai`** | Two-provider fallback: Gemini Flash primary, Claude Sonnet fallback. Logged to `ai_call_log`. Mistral OCR also wired (`MISTRAL_API_KEY`). |
| OCR | **AWS Textract** (server-side) + Mistral OCR fallback | Configured via `AWS_ACCESS_KEY_ID` etc. |
| Background jobs | **Vercel Cron** | NO BullMQ, NO Redis. Cron schedules in `vercel.json`. |
| Hosting | **Vercel** (custom domain `portal.nisla.in`) | Project name `insurance-claims-mis-1kl7`. Sentry for error monitoring (`@sentry/nextjs`). |
| Testing | **Vitest** | One existing test: `tests/executor.test.js`. Coverage is sparse. |
| Doc parsing | `pdf-parse`, `mammoth` (docx), `xlsx` | Server-side document text extraction. |

### Why the divergence?

Several CLAUDE.md choices (TS, Prisma, NextAuth, monorepo, Tauri) were aspirational at project start; the portal evolved organically toward simpler, faster-to-ship choices. Migrating now is a multi-week refactor with no user-facing benefit. **Path forward: keep building on the current stack; revisit a TS migration when the team has bandwidth.**

---

## 4. Project structure (actual)

```
/                        ← Next.js project root (single repo, not monorepo)
  app/
    (route folders)/     ← Each is a Next.js route — page.js + sometimes layout.js
    api/                 ← Server-side API routes — /api/<feature>/route.js
    globals.css          ← App-wide styles
    layout.js            ← Root layout
    page.js              ← Home / dashboard
  components/            ← Shared React components (just 3 right now: GlobalChatBox, LifecycleAdminShell, PageLayout)
  config/                ← Static config (peril codes, depreciation tables — partially populated)
  lib/                   ← Shared logic
    supabase.js          ← Anon Supabase client
    supabaseAdmin.js     ← Service-role Supabase client
    aiClient.js          ← AI provider router (Gemini → Claude fallback)
    aiClients/           ← Per-provider implementations
    comms/               ← Gmail integration helpers
    activityLogger.js    ← Audit log writer
    pipelineStages.js    ← 9-stage claim pipeline (TAT milestones currently HARDCODED here)
    lifecycleEngine.js   ← State machine + lifecycle item bookkeeping
    apiGateway.js        ← File-server proxy
    observability.js     ← Sentry wrapper
  scripts/
    file-server/         ← Standalone Node server for local file storage (separate Vercel deployment)
    puppeteer-server/    ← Standalone PDF renderer
    folder-listener/     ← Watches local folders for new files
    migration_helpers/   ← One-off SQL scripts for OLD→NEW data migration (gitignored: dump files have prod data)
    build_combined_sql.ps1   ← Used during initial Supabase bootstrap
    reorganize_migrations.ps1 ← Used during initial Supabase bootstrap
  supabase/
    config.toml          ← project_id = "nisla-operational-portal"
    migrations/          ← 50 versioned SQL files: <14-digit-UTC-timestamp>_<name>.sql
  docs/                  ← Module specs (registration, ILA, etc.)
  tests/                 ← Vitest tests (currently sparse: 1 file)
  CLAUDE.md              ← This file (untracked in git, kept as local source of truth)
  NISLA_CONTEXT.md       ← Session-handoff context for new Claude sessions
  PORTAL-MAP.md          ← Route/feature map
  next.config.js         ← Next.js config
  vercel.json            ← Vercel cron schedules
  package.json           ← Single package.json (no workspaces)
```

**Rule:** Business logic that doesn't belong in a route should land in `lib/`. Don't sprinkle calculation logic across page components. (Aspiration: extract loss math, lifecycle rules, IRDAI calculations into `lib/domain/` — currently mixed in.)

---

## 5. Core domain model (don't break this)

Primary entities (as they exist in Supabase today):

- **Claim** (`claims` table, BIGSERIAL id) — master record from insurer (ref_number, claim_number, insurer_name, insured_name, LOB, DOL, policy_number, gross_loss, assessed_loss, status, lifecycle phase, etc.)
- **EW Vehicle Claim** (`ew_vehicle_claims`, UUID id) — Extended Warranty subsystem with its own 8-stage flow
- **Assignment** (`claim_assignments`) — many-to-many between claim and surveyor, with role + dates
- **Investigation / activity** (`activity_log`) — every mutation, append-only, immutable
- **Lifecycle** (`claim_lifecycle`, `claim_lifecycle_phases`, `claim_lifecycle_stages`, `claim_lifecycle_items`, `claim_lifecycle_subtasks`, `claim_lifecycle_history`) — generic state machine engine; one `claim_lifecycle` row per active claim or EW claim
- **Documents** (`claim_documents` — generic, currently empty; EW has `ew_claim_media` for photos)
- **Communications** (`inbox_messages`, `message_attachments`, `message_classifications`, `routing_executions`) — Gmail intake + AI triage
- **Survey fee bills** (`survey_fee_bills`) — invoice generation
- **Audit / monitoring** (`activity_log`, `ai_call_log`, `ingestion_runs`, `classification_runs`, `mailbox_audit`)

**Missing from CLAUDE.md spec but called for:**
- `site_visits` — date, location, attendees, photos, observations (not yet built)
- `loss_sheets` — line-item RV / depreciation / salvage / underinsurance / net loss (not yet built)
- `reports` — Interim / Addendum / Final, versioned (only EW Final exists today)
- `surveyors` table exists but is unused for license tracking
- `fee_bill` entity is in `survey_fee_bills` (named differently from spec)

**Claim state machine — actual current state (encoded in `lib/pipelineStages.js` + `lib/lifecycleEngine.js`):**

```
intake_received
  → categorised_intimation
    → registered
      → site_inspection / field_visit / survey
        → ila_submitted
          → documents_pending
            → investigation
              → fsr_drafting
                → assessment
                  → fsr_internal_review
                    → fsr_submitted
                      → closed
                        → reopened → fsr_drafting
  → categorised_other (terminal: document/reminder/duplicate)
```

Side branches: `on_hold`, `withdrawn`, `reopened`. Skipping states is forbidden. Status changes require a reason note when moving backward.

---

## 6. Domain Glossary

Use these terms exactly. Do not invent synonyms.

- **Intimation** — first notice of a loss from insurer to surveyor. Triggers claim creation.
- **ILA (Initial Loss Advice)** — preliminary loss estimate, due within 72 hours of assignment.
- **FSR (Final Survey Report)** — the deliverable. Includes admissibility opinion + loss quantum + annexures.
- **IFSR (Interim FSR / Status Report)** — partial report when investigation is ongoing.
- **Insurer** — insurance company that engaged us (the client). Not the insured.
- **Insured** — the policyholder who suffered the loss.
- **Peril** — cause of loss (fire, flood, theft, machinery breakdown, etc.).
- **TAT (Turnaround Time)** — IRDAI-mandated timelines.
- **CAT** — catastrophe claim (flood/cyclone/riot or others at scale).
- **Salvage** — recoverable value from damaged property.
- **Sum Insured (SI)** — maximum payable under the policy.
- **Reference Number** — Surveyor's office file number (NISLA's internal `ref_number`)
- **Claim Number** — Insurer's claim number
- **File Number** — Insurer's / broker / client file identification number

---

## 7. Insurance domain rules Claude must respect

**The rules below are non-negotiable per IRDAI. Some are encoded in code today; others are TODO. Both are listed.**

| Rule | Encoded today? |
|---|---|
| FSR must include: Cause of Loss, Nature & Extent of Loss, Adequacy of SI, Liability under Policy, Recommended Settlement, Salvage value | ⚠ Partially — only EW FSR template hits all sections; Fire/Marine still need this |
| Never auto-approve coverage. Surveyor signs off. AI never decides admissibility | ✅ AI generates drafts only; human signoff required |
| Underinsurance = (SI / Value at Risk) × Assessed Loss. Always shown, even at 100% | ❌ Not yet built — needs Loss Sheet module |
| Depreciation is item-category driven from `config/depreciation.ts` | ⚠ Config exists but not wired to any form |
| GST on surveyor fees: 18%. TDS handling per insurer | ✅ Survey fee bill has 18% GST. TDS not yet implemented. |
| Reports are versioned. Final cannot be edited — only superseded by Addendum | ⚠ EW FSR generates `claim_fsr_drafts` rows but no immutable Final-Submitted flag yet |
| Photo evidence with EXIF (geotag + timestamp) is mandatory for site visits | ❌ Not yet built — entire site visit module missing |
| PSU reporting style: numbered sections, `Annexure-A`/`B`/..., signed page | ⚠ EW FSR has structure; Fire/Marine don't |

---

## 8. Coding standards (current reality)

- **JavaScript (ES modules).** No `.ts`/`.tsx` files. If you're tempted to add TypeScript, ask first — it's a future migration, not a per-file decision.
- **API routes:** `export async function GET(req)` / `export async function POST(req)` in `app/api/<feature>/route.js`. Use `NextResponse.json(...)`.
- **Server actions:** Not used. Mutations go through `fetch('/api/...')` from client → API route.
- **One component = one file.** Avoid mega-files; if a component grows past ~500 lines, split.
- **Money values:** Stored as `NUMERIC` in Postgres. Display via Indian-locale formatting (`new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`). Aspiration to move to integer paise — not yet done.
- **Dates:** Stored as `TIMESTAMPTZ` in UTC. Display in IST. Date math: rely on `Date` objects + manual offset for IST where needed (date-fns is not yet a dependency).
- **Errors:** Throw, catch in API route, return `NextResponse.json({ error: '...' }, { status: 4xx/5xx })`. Client surfaces via toasts / alert UIs.
- **Audit logging:** Use `lib/activityLogger.js` for any claim-state mutation. `INSERT INTO activity_log` with `user_email`, `user_name`, `action`, `entity_type`, `entity_id`, `company`. Never expose a delete endpoint for `activity_log`.
- **No `console.log` in committed code.** Use Sentry breadcrumbs or `lib/observability.js`. (In practice, scattered console.logs exist — clean as you go.)

---

## 9. Security & data handling

| Rule | Status |
|---|---|
| Insurance data is sensitive. Treat every claim record as confidential. | ✅ Internal-only access; no public endpoints exposing claim data |
| **PII fields encrypted at rest using `pgcrypto`** | ❌ NOT implemented. Tech debt. |
| Mask claim numbers in logs as `CLM-****-1234` | ⚠ Inconsistent — refactor needed |
| Document uploads: scan size + MIME, max 25MB | ❌ Most upload endpoints do neither |
| Audit log is append-only, no delete endpoint | ✅ Enforced |
| Role checks on every server action, default deny | ⚠ Spotty — many endpoints accept any logged-in user. RLS not yet configured. |
| **API keys never client-side** | ✅ All AI/OCR/Storage keys are server-only env vars |
| **Passwords hashed with bcrypt/argon2** | ❌ **Plain text in `app_users.password_hash`** — top priority cleanup |

---

## 10. Common commands

```bash
# Dev (single app, runs Next.js dev server)
npm run dev                 # next dev — local at http://localhost:3000

# Production build / start
npm run build               # next build
npm start                   # next start

# Tests
npm test                    # vitest run (one test exists: tests/executor.test.js)
npm run test:watch          # vitest watch mode

# Supabase migrations (local dev workflow — not yet scripted)
# Migrations live in supabase/migrations/. Apply via Supabase SQL Editor or psql.
# CLI: supabase db push --linked --include-all  (requires DB password; current NEW project has CLI auth issues — use psql directly)
```

There is no `lint`, `typecheck`, `db:migrate`, `db:seed`, or `db:studio` script today. Add them as needs arise.

---

## 11. Active priorities (29 April 2026)

### Where we are: ~50% of CLAUDE.md vision is built

| Phase | % done | Status |
|---|---|---|
| **Phase 1 MVP** (claims tracker, intake, dashboard, FSR PDF, Fire LOB) | ~55% | Lifecycle engine, EW module, Gmail intake, dashboards, masters, audit log all in place. **MISSING: site visit module, loss sheet builder, DB-driven Fire/Marine FSR templates, bcrypt passwords** |
| **Phase 2** (Marine, fee bill polish, insurer portal, email auto-intake) | ~30% | EW fee bills work; Marine LOB selectable but no form; insurer portal not started; auto-intake partially manual |
| **Phase 3** (CAT mode, mobile, analytics) | ~7% | Almost nothing started |

### Recommended order (do not skip ahead without asking)

**This week — clear regulatory blockers**
1. **Bcrypt the passwords in `app_users`** + update `app/api/auth/login/route.js`
2. **Wire up the orphaned `surveyors` table** for IRDAI license tracking (license number + expiry)
3. **Add `site_visits` table + photo upload UI** (geotag + EXIF)

**Next 2 weeks — close Phase 1 MVP for Fire LOB**
4. **Loss sheet builder** for Fire claims (RV / depreciation / salvage / underinsurance / net loss)
5. **Move Fire FSR template from hardcoded strings to `fsr_templates` rows** + DB-driven rendering
6. **End-to-end Fire claim test:** register → site visit → loss sheet → ILA → FSR

**Month 2 — Phase 2 revival**
7. Marine Cargo form (replicate Fire pattern after #4-6 land)
8. Insurer read-only portal via Supabase RLS
9. Fee bill polish: TDS, per-insurer rate tables

**Month 3+ — only after Phase 1 ships**
10. CAT bulk-claim mode
11. Manager analytics + trend dashboards
12. Tauri portable build research (offline-first)

---

## 12. What Claude must NOT do

- Don't suggest hiring or outsourcing — solve it in code.
- Don't introduce a new framework, ORM, or auth library without justification (you'll be moving against years of accumulated context).
- Don't generate insurance policy interpretation or admissibility decisions — that's the surveyor's job. Build the tool, not the verdict.
- Don't break the audit log contract.
- Don't add features outside the current Phase priority unless asked.
- Don't write code without checking `lib/` first — half the helpers are already there.
- Don't rewrite the codebase to TypeScript silently. If TS is the right call for one file, ask first.
- Don't generate fake claim data on `app_users` / `claims` / etc. in prod — only in test scripts under `tests/`.

---

## 13. IRDAI Rules That Matter (Encode in Code)

These aren't suggestions — they're regulatory:

- **Surveyor must be IRDAI licensed** for the relevant category. Track license number + expiry per surveyor. *(Pending — `surveyors` table exists but unused.)*
- **72 hours** for ILA from date of assignment. *(Tracked in `pipelineStages.js` — hardcoded; should be DB-config.)*
- **30 days** for FSR submission (small claims), **45 days** (medium), **90 days** (catastrophe/large). *(Per IRDAI Surveyors & Loss Assessors Regulations 2015.)*
- **Audit trail** is mandatory: every status change, field edit, document upload, and report generation must be logged with user + timestamp + before/after values. *(`activity_log` covers most paths; some AI mutations bypass it.)*
- **Independence** — surveyor cannot have conflict of interest with insurer or insured. Track via a conflict declaration on assignment. *(Not yet built.)*
- **Fee structure** follows IRDAI scale unless special agreement exists. *(GIPSA fee schedule loaded in `gipsa_fee_schedule` table — used by EW and survey_fee_bill modules.)*
- **Data residency** — claim data must be stored in India. *(Supabase NEW project is in `ap-south-1` Mumbai. ✅)*

If a code change conflicts with any of the above, stop and ask the user before proceeding.

---

## 14. When in doubt

Ask, in this order:
1. Is there an existing pattern in `app/` or `lib/`? Match it.
2. Does it touch the claim state machine or money math? Stop and confirm.
3. Is the requirement IRDAI-driven? Cite the regulation in the PR.
4. Otherwise, pick the simplest thing that ships and write a Vitest test.

---

## 15. References

- IRDAI Surveyors and Loss Assessors Regulations, 2015
- IRDAI (Protection of Policyholders' Interests) Regulations, 2017
- Internal: `docs/registration-module-spec.md`
- Internal: `docs/fsr-template-format.md` (TBD)
- Internal: `docs/per-insurer-quirks.md` (TBD)
- Internal: `docs/ila-module-spec.md`
- Internal: `docs/provenance-conflict-system-spec.md`
- Internal: `NISLA_CONTEXT.md` (session-state and migration history)
- Internal: `PORTAL-MAP.md` (route/feature map)

---

## 16. Working With Claude (How to Prompt Me)

When asking for changes, include:
1. **Module** affected (registration, ILA, comms, etc.)
2. **User role** that triggers the action (admin / manager / lead_surveyor / etc.)
3. **Expected state transition** (if any)
4. **Whether audit logging is required** (yes for claim data, no for UI prefs)

Prefer small focused PRs. If a task touches >3 files or >500 lines, break it up.

Before writing code:
- Re-read this CLAUDE.md
- Check current schema via Supabase SQL Editor (read-only)
- Check `NISLA_CONTEXT.md` for recent session context (e.g. project refs, credentials state)
- Confirm the module spec in `docs/<module>-spec.md` if one exists
- Ask if anything is ambiguous — don't guess on regulatory or domain rules

---

## 17. Common Pitfalls (Read Before Coding)

- **Don't hardcode peril-specific logic.** Use config tables + peril metadata. We add new perils every few years. *(Currently violated: Fire/Marine FSR templates are hardcoded strings.)*
- **Don't store derived fields.** Compute `loss_age_days`, `tat_status`, etc. in views or on read.
- **Don't bypass the audit trigger.** All claim mutations through the standard path (`lib/activityLogger.js`).
- **Don't assume single surveyor.** Assignment is a many-to-many with roles. Large/CAT claims have lead + team.
- **Don't store documents inline.** Always Supabase Storage or the file-server, with metadata in DB.
- **Don't email from the app process synchronously.** Queue via cron or Pub/Sub. Email failures must not break user actions.
- **Don't trust insurer-provided claim numbers.** Always generate our own NISLA `ref_number` too.
- **Don't roll your own date math.** Use the existing helpers in `lib/`. If you reach for `new Date()`, double-check IST handling.
- **Don't `INSERT INTO ...` claim/policy data via positional VALUES.** Always name the columns. Schema drift between OLD and our migrations bit us during the OLD→NEW migration.

---

## 18. State Machine: Claim Status

Valid transitions only — enforce in DB trigger / `lib/lifecycleEngine.js`:

```
intake_received
  → categorised_intimation
    → registered
      → Site Inspection / field visit / survey
        → ila_submitted
          → documents_pending
            → investigation
              → fsr_drafting
                → Assessment in claims
                  → fsr_internal_review
                    → fsr_submitted
                      → closed
                        → reopened → fsr_drafting
  → categorised_other (terminal: document/reminder/duplicate)
```

Side branches: `on_hold`, `withdrawn`, `reopened`. Skipping states is forbidden. Status changes require a reason note when moving backward.

---

## 19. User Roles & Permissions

| Role | Capabilities |
|---|---|
| `admin` | Full access, user management, settings |
| `manager` | View all claims in their region/practice, assign surveyors, approve fees |
| `lead_surveyor` | Full access to assigned claims, sign FSRs |
| `co_surveyor` | Edit access to assigned claims, cannot sign FSR |
| `engineer` | Technical input on Engineering/EEI claims |
| `ca` | Financial verification, BI computation, salvage valuation |
| `inward_clerk` | Email categorisation only |
| `read_only` | View dashboards, no edits |

**Aspiration:** Enforce via Supabase RLS — never via frontend checks alone.
**Reality today:** Roles exist as a `role` column on `app_users`. Frontend reads it for navigation. **Server-side enforcement is sparse — many API routes accept any logged-in user.** Tightening RLS is a Phase 2 task.

---

## 20. Migration history (recent)

- **29 April 2026 — Supabase migration OLD → NEW.** OLD project `ffljqrcavjkfpkvvsvza` data fully imported into NEW project `khtxngncvkwhoaybiigt`. 50 SQL migrations + 2 backfill (`surveyors` table, 10 legacy columns on `claims`/`inbox_messages`/`policy_types`). All 363 claims, 144 policies, 17 users, 476 emails preserved with row-count parity. Vercel cut over to NEW. Gmail OAuth, Pub/Sub watch, cron all verified working. **Tooling and gotchas documented in `NISLA_CONTEXT.md` § 4a.**

---

_Last updated: 29 April 2026 — Owner: NISLA Tech / ACUERE Team_

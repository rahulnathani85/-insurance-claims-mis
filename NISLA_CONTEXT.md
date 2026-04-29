# NISLA SurveyorMIS — Project Context for Claude

**Last updated:** 29 April 2026
**Maintainer:** Rahul Nathani

---

## 1. Organization

| Entity | License | Role |
|---|---|---|
| Nathani Insurance Surveyors and Loss Assessors Pvt. Ltd. | IRDAI/CORP/SLA-200025 | Primary corporate entity |
| Acuere Surveyors | IRDAI/IND/SLA-85225 | Secondary individual licence |

Brand operating umbrella: NISLA. Both entities operate from the same portal.

## 2. Portal — SurveyorMIS

| Attribute | Value |
|---|---|
| Stack | Next.js 14 / React 18 / Tailwind / TypeScript |
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions) |
| Hosting | Vercel |
| Custom domain | portal.nisla.in |
| Vercel URL | insurance-claims-mis-1kl7.vercel.app |
| Repo | github.com/nathaniinsurance/nisla-operational-portal |
| Default branch | main (renamed from master March 2026) |
| Supabase project (NEW, current) | `khtxngncvkwhoaybiigt` (nisla-portal-prod, ap-south-1) |
| Supabase project (OLD, decommissioning) | `ffljqrcavjkfpkvvsvza` (kept running 7-14 days as rollback) |
| Admin login (custom auth via app_users) | `Rahul Nathani` / `Peeyush Nathani` etc. — passwords from OLD |
| auth.users orphan (created during password debug, unused) | `919f78e7-ef23-4385-8cd4-f2bd4f5b302d` (claim.intimation@nisla.in) |

## 3. Existing pipeline (relevant to AI integration)

| Stage | Tool | Output |
|---|---|---|
| Document upload | Surveyor uploads PDFs/images | Files in Supabase Storage |
| OCR | (existing pipeline) | Raw text |
| Structuring | Claude Sonnet (preprocessing call) | Structured fields → Supabase tables |
| Storage | Supabase Postgres | Clean policy/claim records |

**Important:** Claim data lives as structured JSON in Supabase. Any AI verification step should consume that JSON, not re-parse PDFs.

## 4. Active workstreams

### 4a. Supabase migration — ✅ COMPLETE (29 Apr 2026)

Migrated from OLD project `ffljqrcavjkfpkvvsvza` to NEW project
`khtxngncvkwhoaybiigt`. Plan evolved during the day from "fresh start" →
"selective migration" → "full data migration", final state: full data parity.

#### Phase summary

| Phase | Outcome | Commits |
|---|---|---|
| 1. CLI workspace + reorganize 48 hand-written SQL files into `supabase/migrations/<14-digit-UTC>_<name>.sql` | ✅ | `050c045` |
| 2. Fix 3 latent schema bugs uncovered on fresh-DB bootstrap (UUID-vs-BIGINT FKs in v10/v14, claim_documents create-vs-alter race, fix_inconsistencies invalid column) | ✅ | `318c330` |
| 3. Apply all 48 migrations via SQL Editor (per-migration tx + tracking table workaround for failed `supabase db push` due to broken DB password) | ✅ | (manual SQL Editor run) |
| 4. Record migrations in `supabase_migrations.schema_migrations` (CLI bookkeeping) | ✅ | (manual) |
| 5. Vercel cutover — 3 env vars + redeploy w/o cache | ✅ | (manual) |
| 6. Discover app uses **custom auth via `app_users` table** (NOT Supabase Auth). Plain-text passwords in `password_hash` column. | (security debt logged) | — |
| 7. OLD→NEW data migration via pg_dump --column-inserts + psql import w/ `session_replication_role = replica` | ✅ | `30b4a78` |
| 8. Add 2 backfill migrations for OLD's manual schema drift (`surveyors` table + 10 columns on claims/inbox_messages/policy_types) | ✅ | `30b4a78` |
| 9. Verify Gmail OAuth (tokens imported, Watch active, Pub/Sub pushing, cron polling) | ✅ verified | — |
| 10. Verify Vault — empty on both sides, nothing to migrate | ✅ verified | — |

#### Final row-count parity (OLD vs NEW)

All 70+ tables match exactly except `claim_documents` (52 rows in OLD,
deliberately skipped because OLD had `id UUID` and NEW had `id BIGINT` from
the v5 schema).

Headline numbers in NEW:
- 363 claims, 144 policies, 129 ew_vehicle_claims, 17 app_users
- 4535 activity_log, 1876 ingestion_runs, 1146 classification_runs
- 476 inbox_messages (live emails — Gmail Watch pushing new ones)

#### Hard-won gotchas (for future reference)

| Gotcha | What to do |
|---|---|
| Supabase CLI 2.95.4 rejects `sbp_v0_*` access tokens | Strip `v0_` → use legacy `sbp_<40-hex>` form |
| `supabase link` Management API fails for projects in different orgs | Use `pg_dump --db-url=...` with direct connection string instead |
| `supabase db dump` requires Docker Desktop | Install Postgres client via Scoop instead: `scoop install postgresql` (binary at `~\scoop\apps\postgresql\<ver>\bin\pg_dump.exe`) |
| NEW project DB password reset wouldn't propagate via `supabase link` | Direct `psql` connection bypassed the CLI bug entirely |
| pg_dump default `--inserts` uses positional VALUES — fails on column-order drift | Always use `--column-inserts` for cross-DB migrations |
| Circular FK warnings (claims↔inbox_messages, lifecycle_templates self-ref) | Wrap import in `SET session_replication_role = 'replica';` ... `SET ... = 'origin';` |
| Vercel cron jobs (comms_cron_*) actively wrote to NEW between truncate and import | Always do truncate + import in **single transaction** (`psql --single-transaction`) |
| Schema drift between OLD and our migration files (8 columns on claims, surveyors table never in any migration) | Codified as backfill migrations `20260429210000` and `20260429210001` |
| App's "User ID" login field uses `app_users.name` (not email), passwords stored as plain text | Tech debt: bcrypt or migrate to Supabase Auth |

#### Credentials state at end of session

| Resource | State |
|---|---|
| OLD DB password | Reset to `QI8SvmVKyuEvi7zb` for the migration. **Should be rotated/deleted** when OLD is decommissioned. |
| NEW DB password | `NislaMig2026XyZ7q` (works for direct psql; the `supabase link` flow is broken on this project but that doesn't block anything) |
| Supabase access token (claim.intimation@nisla.in) | `sbp_aed0bdc576fe6c65d41707e2c2bac0d346e49fd6` (legacy format) — works on NEW only |
| OLD Vercel env vars | User saved snapshot before cutover (for rollback) |

#### Optional follow-ups (NOT urgent)

| Item | Why | Effort |
|---|---|---|
| `claim_documents` (52 rows skipped) | User chose to upload files directly going forward; old metadata orphaned | Decide skip permanently OR write a migration that maps OLD UUIDs to new BIGINT ids |
| Delete the orphaned `auth.users` row (`919f78e7-...`) | Created during NEW password debugging, unused; clutter | 1 SQL statement |
| Deactivate v6 dev seeds in app_users (`surveyor@nisla.in` / `staff@nisla.in` / `dev@nisla.in`) | Already inactive on import for surveyor/staff but live seeds clutter the user list | 1 SQL statement |
| Bcrypt-hash `app_users.password_hash` | Currently plain text — security debt | ~30 min: hash existing values, update login route |
| Delete local pg_dump files in `scripts/migration_helpers/old_data_dump*.sql` | Contain prod data, no longer needed | Just delete them |
| Decommission OLD project after 7-14 day stability window | Cost + reduce attack surface | Single click in Supabase dashboard |

### 4b. Claim verification skill (planned)

Architecture B chosen: SKILL.md hosted in NISLA repo, not uploaded to Anthropic. Reasoning consumes Supabase structured JSON. Sonnet 4.6 recommended over Opus 4.7 for cost. Estimated ₹4-7/claim cached, ~5-12 sec latency.

Planned enhancements: tool-use structured outputs, two-pass triage (Haiku → Sonnet), confidence threshold for human-in-loop, clause citation enforcement, verdict versioning with skill git hash.

## 5. Conventions for Claude

| Rule | Reason |
|---|---|
| Present data in tables, not paragraphs | User preference |
| Be precise with numbers; never round unless asked | Insurance domain |
| Treat claim/policy data as PII | IRDAI compliance |
| Verify before destructive DB operations | Audit trail required |
| Always log skill version + model + tokens with AI verdicts | Reproducibility for IRDAI audits |
| INR conversion: use ₹83.50/USD as default unless current rate provided | Consistent estimates |

## 6. Environment

| Item | Value |
|---|---|
| OS | Windows 10/11 |
| Shell | PowerShell (NOT cmd.exe — multiline paste issues) |
| Package manager | Scoop |
| Supabase CLI | v2.95.4 |
| pg_dump / psql | 18.3 (`%USERPROFILE%\scoop\apps\postgresql\18.3\bin\`) |
| Working directory | `E:\NISLA-ACUERE MIS PROJECT\-insurance-claims-mis-main` |

## 7. Files in repo (key paths)

| Path | Purpose |
|---|---|
| `/supabase/config.toml` | CLI workspace, project_id = "nisla-operational-portal" |
| `/supabase/migrations/` | 50 versioned SQL migrations (48 original + 2 backfill from 29 Apr) |
| `/scripts/migration_helpers/` | One-off scripts from OLD→NEW data migration (gitignored .sql dumps live here) |
| `/scripts/build_combined_sql.ps1` | Generates `_combined_for_sql_editor.sql` from migrations/ folder. Used during initial bootstrap when CLI was blocked. |
| `/scripts/reorganize_migrations.ps1` | One-off, used for the initial 48-file reorganization on 29 Apr |
| `/skills/marine-cargo-verifier/SKILL.md` | (planned) Claim verification rules |
| `NISLA_CONTEXT.md` | This file — context for any new Claude session |

## 8. Other related projects (NOT this portal)

For Claude's awareness — these are separate codebases, do not mix:

| Project | Stack | Purpose |
|---|---|---|
| Valuation Platform | Electron + React | IBBI valuation reports (latest v5.38h) |
| ProNexus | Next.js + Supabase | Marketplace for Indian finance/law professionals |

## 9. Known constraints

- No AI auto-finalization of claim verdicts; surveyor signoff required
- API keys never client-side
- Login is custom auth via `app_users.password_hash` (plain text, security debt — bcrypt cleanup pending)
- Storage objects deliberately not migrated from OLD; new files uploaded directly going forward
- The `claim_documents` table on NEW is empty; OLD's 52 rows of file metadata orphaned (intentional skip)

## 10. How to use this file

A new Claude session should:
1. Read this file fully before suggesting any action
2. Ask Rahul for any field marked "(to be confirmed)" or "Pending"
3. Update this file at end of session with new state
4. Never assume context — verify against this document first

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
| Admin user | claim.intimation@nisla.in |
| Admin UUID | a206f0bb-5009-4398-9cc7-2217340d7a8e |

## 3. Existing pipeline (relevant to AI integration)

| Stage | Tool | Output |
|---|---|---|
| Document upload | Surveyor uploads PDFs/images | Files in Supabase Storage |
| OCR | (existing pipeline) | Raw text |
| Structuring | Claude Sonnet (preprocessing call) | Structured fields → Supabase tables |
| Storage | Supabase Postgres | Clean policy/claim records |

**Important:** Claim data lives as structured JSON in Supabase. Any AI verification step should consume that JSON, not re-parse PDFs.

## 4. Active workstreams

### 4a. Supabase migration (in progress)

**Plan changed from "migrate OLD → NEW" to "fresh start on NEW account"** (29 Apr).
The user moved to a brand-new Supabase account (login: claim.intimation@nisla.in)
with project `khtxngncvkwhoaybiigt` in `ap-south-1` (Mumbai). Data on OLD is being
left behind — only the schema (48 migrations) ports forward.

| Step | Status |
|---|---|
| Pre-flight checklist | Done |
| Install Supabase CLI v2.95.4 via Scoop on Windows | Done (28 Apr) |
| `supabase init` in repo | **Done (29 Apr)** — config.toml + .gitignore created |
| Reorganize 48 hand-written .sql files into supabase/migrations/ with 14-digit UTC prefixes | **Done (29 Apr)** — git-mv preserved history; commit 050c045 |
| Delete typo'd `migration_comms_10_routing.sql.sql` (BIGINT vs UUID duplicate) | **Done (29 Apr)** |
| Set project_id = "nisla-operational-portal" in config.toml | **Done (29 Apr)** |
| Link CLI to new project khtxngncvkwhoaybiigt | **Done (29 Apr)** |
| `supabase migration list --linked` (verify remote empty) | **Blocked** — DB password needs reset; first attempt rejected |
| `supabase db push --linked --include-all` (apply 48 migrations) | Pending — blocked on password |
| Migrate Storage buckets (PDFs/images) from OLD → NEW | Pending |
| Re-create Auth providers (Google OAuth, Gmail OAuth) | Pending |
| Re-create Vault secrets | Pending |
| Update Vercel env vars (URL, anon, service-role) to NEW | Pending |
| Smoke-test on Vercel preview | Pending |
| Cutover production traffic | Pending |
| Keep OLD running 7-14 days | Pending |
| Establish forward-going migration workflow | Effectively done (CLI workspace now in place) |

**Token-format note:** CLI 2.95.4 rejects the new dashboard `sbp_v0_*` token
prefix. Strip `v0_` to use legacy `sbp_<40-hex>` format.

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
| Working directory | (to be confirmed) |

## 7. Files in repo (key paths)

| Path | Purpose |
|---|---|
| `/supabase/` | CLI workspace (after `supabase init`) |
| `/supabase/migrations/` | Versioned SQL migrations |
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
- Storage objects must be migrated separately from SQL dumps (rclone or supabase storage CLI)
- Vault secrets must be re-created manually post-migration

## 10. How to use this file

A new Claude session should:
1. Read this file fully before suggesting any action
2. Ask Rahul for any field marked "(to be confirmed)" or "Pending"
3. Update this file at end of session with new state
4. Never assume context — verify against this document first

# NISLA SurveyorMIS — Project Context for Claude

**Last updated:** 28 April 2026
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
| URL | nisla-operational-portal.vercel.app |
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

Migrating from OLD Supabase project to NEW. 14-step plan drafted:

| Step | Status |
|---|---|
| Pre-flight checklist | Done |
| Install Supabase CLI v2.95.4 via Scoop on Windows | Done (28 Apr) |
| `supabase init` in repo | Pending |
| Link to OLD project, `supabase db pull` | Pending |
| Three-file dump (roles, schema, data) | Pending |
| Pause portal writes | Pending |
| Create NEW Supabase project (Singapore region) | Pending |
| Restore in order to NEW | Pending |
| Migrate Storage / Edge Functions / Auth providers / Vault | Pending |
| Verify row counts and RLS | Pending |
| Smoke-test on Vercel preview | Pending |
| Cutover production env vars | Pending |
| Keep OLD running 7-14 days | Pending |
| Establish migration workflow going forward | Pending |

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

# Portal Map — Insurance Claims MIS

_Generated: 2026-04-18. Read-only audit of what currently exists. No recommendations in this document._

## 0. Overview

Next.js 13+ App Router portal (`app/` directory, `use client` per-page) deployed on Vercel, backed by Supabase (PostgreSQL + Storage) with a companion Windows file-server stack (`scripts/file-server`, `scripts/puppeteer-server`, `scripts/folder-listener`) for on-premise folder I/O under `D:\2026-27\`. Uses `@supabase/supabase-js` (both anon `supabase` and service-role `supabaseAdmin`), integrates Google Gmail OAuth, Google Gemini + Anthropic Claude for AI features, and Puppeteer for server-side PDF generation. Auth is a bespoke email/password flow against `app_users` with `sessionStorage`-gated `AuthContext`.

Totals:
- Pages: 32 page.js files (under `app/**` excluding `app/api`).
- API routes: 71 route.js files (under `app/api/**`).
- SQL files: 28 (`supabase/*.sql` = 27 plus one stray `migration_v10_claim_documents_gmail.sql` at repo root).
- Consolidated tables: 34 tables after applying all migrations.
- Components: 2 (`components/GlobalChatBox.js`, `components/PageLayout.js`).
- Lib modules: 10 (`AuthContext`, `CompanyContext`, `constants`, `supabase`, `supabaseAdmin`, `ewStages`, `pipelineStages`, `aiClient`, `activityLogger`, `documentExport`).

---

## 1. Routes & Pages

| Route | File | Purpose (one line) | Auth-gated? | Company-scoped? |
|-------|------|--------------------|-------------|------------------|
| `/` | `app/page.js` | Dashboard: stats cards, LOB distribution, pipeline, TAT breaches, my-assignments, unread mentions, all-claims table. | yes | yes |
| `/login` | `app/login/page.js` | Login screen with quick-login (remembered user) and full-login forms. | no | no |
| `/backup` | `app/backup/page.js` | Admin page to export table JSON/CSV backups. | yes | yes |
| `/activity-log` | `app/activity-log/page.js` | Admin-only activity log viewer with filters. | yes | yes |
| `/user-management` | `app/user-management/page.js` | Admin-only CRUD over `app_users`. | yes | yes |
| `/user-monitoring` | `app/user-monitoring/page.js` | Admin view of user sessions / last active. | yes | yes |
| `/workflow-overview` | `app/workflow-overview/page.js` | Cross-claim workflow/stage overview with filters. | yes | yes |
| `/file-tracking` | `app/file-tracking/page.js` | Per-file document/stage tracker (`claim_documents`, `claim_stages`). | yes | yes |
| `/file-assignments` | `app/file-assignments/page.js` | Team assignment management for claims. | yes | yes |
| `/claim-registration` | `app/claim-registration/page.js` | LOB selector grid that routes to `/claims/[lob]` (or Marine modal). | yes | yes |
| `/claim-lifecycle/[id]` | `app/claim-lifecycle/[id]/page.js` | Lifecycle detail view for a single claim (workflow + TAT + reminders). | yes | yes |
| `/claim-detail/[id]` | `app/claim-detail/[id]/page.js` | Full detail view for a single claim. | yes | yes |
| `/claim-categories` | `app/claim-categories/page.js` | Admin CRUD over the hierarchical `claim_categories` tree. | yes | yes |
| `/claims/[lob]` | `app/claims/[lob]/page.js` | Main claim-registration/edit page per LOB; huge form + list. | yes | yes |
| `/documents/[claimId]` | `app/documents/[claimId]/page.js` | Document upload/browse for a claim (Supabase Storage + file server). | yes | yes |
| `/policy-directory` | `app/policy-directory/page.js` | Read-only browse of policies master. | yes | yes |
| `/policy-master` | `app/policy-master/page.js` | CRUD of `policies`; upload/download policy copy. | yes | yes |
| `/broker-master` | `app/broker-master/page.js` | CRUD of `brokers`. | yes | yes |
| `/insurer-master` | `app/insurer-master/page.js` | CRUD of `insurers` + `insurer_offices`. | yes | yes |
| `/survey-fee-bill` | `app/survey-fee-bill/page.js` | Survey-fee bill creation + GIPSA fee preview. | yes | yes |
| `/ref-number-portal` | `app/ref-number-portal/page.js` | View/reset `ref_counters` and `marine_counters`. | yes | yes |
| `/lor-ila-generator` | `app/lor-ila-generator/page.js` | Template-based LOR/ILA document generation with placeholder fill. | yes | yes |
| `/mis-portal` | `app/mis-portal/page.js` | Cross-claim MIS report with many filters; Excel export. | yes | yes |
| `/fsr-template-editor` | `app/fsr-template-editor/page.js` | Landing page for FSR template editor. | yes | yes |
| `/fsr-template-editor/ew-vehicle` | `app/fsr-template-editor/ew-vehicle/page.js` | Editor for `fsr_templates` (EW vehicle). | yes | yes |
| `/ew-vehicle-claims` | `app/ew-vehicle-claims/page.js` | EW vehicle claims list with filters/search. | yes | yes |
| `/ew-vehicle-claims/[id]` | `app/ew-vehicle-claims/[id]/page.js` | EW claim detail with tabs, stages, media, FSR generate. | yes | yes |
| `/ew-vehicle-claims/register` | `app/ew-vehicle-claims/register/page.js` | New EW claim intake form (sections: claim, vehicle, dealer, complaint). | yes | yes |
| `/ew-vehicle-claims/dashboard` | `app/ew-vehicle-claims/dashboard/page.js` | EW-only dashboard (stage counts, surveyor distribution). | yes | yes |
| `/ew-vehicle-claims/mis` | `app/ew-vehicle-claims/mis/page.js` | EW-only MIS report with filter panel and lot badges. | yes | yes |
| `/ew-lots` | `app/ew-lots/page.js` | EW lots list. | yes | yes |
| `/ew-lots/new` | `app/ew-lots/new/page.js` | Create new EW lot (pick claims with FSR generated). | yes | yes |
| `/ew-lots/[id]` | `app/ew-lots/[id]/page.js` | Lot detail + Excel download. | yes | yes |

### 1.1 API Route Handlers

| Method(s) | Route | File | Purpose (one line) |
|-----------|-------|------|--------------------|
| POST | `/api/auth/login` | `app/api/auth/login/route.js` | Verifies credentials against `app_users`; logs `login` activity. |
| GET, POST | `/api/auth/users` | `app/api/auth/users/route.js` | List/create `app_users`. |
| GET, PUT, DELETE | `/api/auth/users/[id]` | `app/api/auth/users/[id]/route.js` | Fetch/update/delete single user. |
| GET, POST | `/api/brokers` | `app/api/brokers/route.js` | List/create brokers. |
| PUT, DELETE | `/api/brokers/[id]` | `app/api/brokers/[id]/route.js` | Update/delete broker. |
| GET, POST | `/api/insurers` | `app/api/insurers/route.js` | List/create insurers (with nested offices in list). |
| GET, PUT | `/api/insurers/[id]` | `app/api/insurers/[id]/route.js` | Fetch/update insurer. |
| POST, PUT, DELETE | `/api/insurer-offices/[id]` | `app/api/insurer-offices/[id]/route.js` | CRUD of a specific insurer_office under an insurer. |
| GET | `/api/offices` | `app/api/offices/route.js` | Flat read of `insurer_offices` joined with insurer name. |
| GET, POST | `/api/policies` | `app/api/policies/route.js` | List/create policies. |
| PUT, DELETE | `/api/policies/[id]` | `app/api/policies/[id]/route.js` | Update/delete policy. |
| GET | `/api/policies/[id]/download-copy` | `app/api/policies/[id]/download-copy/route.js` | Returns policy_copy_url. |
| POST | `/api/policies/[id]/upload-copy` | `app/api/policies/[id]/upload-copy/route.js` | Upload policy copy to Supabase Storage bucket `documents`. |
| GET | `/api/policy-types` | `app/api/policy-types/route.js` | List all policy types. |
| POST, PUT, DELETE | `/api/policy-types` (extra methods) | `app/api/policy-types/route.js` | Also exports POST/PUT/DELETE for CRUD. |
| GET | `/api/policy-types/[lob]` | `app/api/policy-types/[lob]/route.js` | List types scoped to a LOB. |
| GET, POST, PUT, DELETE | `/api/ref-numbers` | `app/api/ref-numbers/route.js` | Ref-counter admin endpoints. |
| GET | `/api/ref-structure` | `app/api/ref-structure/route.js` | Reads all ref + marine counters for display. |
| POST | `/api/ref-structure/reset/[lob]` | `app/api/ref-structure/reset/[lob]/route.js` | Reset a counter to a new value. |
| GET | `/api/tentative-ref/[lob]` | `app/api/tentative-ref/[lob]/route.js` | Preview next ref number for a LOB/client_category. |
| GET, POST | `/api/claims` | `app/api/claims/route.js` | List/create claims; increments counters; creates an initial `claim_stages` row. |
| GET, PUT, DELETE | `/api/claims/[id]` | `app/api/claims/[id]/route.js` | Fetch/update/delete a claim; handles counter rollback and EW-claim sync. |
| GET, POST | `/api/claim-assignments` | `app/api/claim-assignments/route.js` | List/create team assignments (also returns user-workload aggregate). |
| PUT, DELETE | `/api/claim-assignments/[id]` | `app/api/claim-assignments/[id]/route.js` | Update/delete assignment. |
| GET, POST, PUT, DELETE | `/api/claim-categories` | `app/api/claim-categories/route.js` | CRUD over hierarchical `claim_categories`. |
| GET, POST | `/api/claim-documents` | `app/api/claim-documents/route.js` | List/create `claim_documents` rows (and storage upload). |
| GET, DELETE | `/api/claim-documents/[id]` | `app/api/claim-documents/[id]/route.js` | Fetch/delete single doc (removes storage object). |
| GET, POST | `/api/claim-messages` | `app/api/claim-messages/route.js` | Per-claim chat messages; inserts `activity_log`. |
| GET, POST | `/api/claim-reminders` | `app/api/claim-reminders/route.js` | Reminder CRUD (LOR/gentle/final reminders). |
| GET, POST | `/api/claim-stages` | `app/api/claim-stages/route.js` | Pipeline stage history for claims (updates caches on claims). |
| GET, POST | `/api/claim-workflow` | `app/api/claim-workflow/route.js` | Per-claim workflow stage rows (TAT + due_date). |
| PUT | `/api/claim-workflow/[id]` | `app/api/claim-workflow/[id]/route.js` | Update a workflow stage (logs history). |
| GET, POST | `/api/claim-workflow-history` | `app/api/claim-workflow-history/route.js` | Comments / history rows. |
| GET | `/api/dashboard-stats` | `app/api/dashboard-stats/route.js` | Aggregates claim counts by pipeline progress for dashboard tiles. |
| GET, POST | `/api/document-templates` | `app/api/document-templates/route.js` | List/create LOR/ILA templates. |
| GET, PUT, DELETE | `/api/document-templates/[id]` | `app/api/document-templates/[id]/route.js` | Fetch/update/delete template. |
| GET, POST | `/api/documents/[claimId]` | `app/api/documents/[claimId]/route.js` | Supabase Storage list/upload under `documents/` bucket. |
| GET | `/api/export-excel` | `app/api/export-excel/route.js` | Claims → XLSX export. |
| POST | `/api/extract-policy` | `app/api/extract-policy/route.js` | Parse uploaded policy PDF/DOCX to auto-fill form fields. |
| GET | `/api/file-proxy` | `app/api/file-proxy/route.js` | HTTPS proxy to the local file server (`D:\2026-27`). |
| POST | `/api/generate-pdf` | `app/api/generate-pdf/route.js` | Puppeteer PDF generation (forwards to puppeteer-server). |
| POST, GET | `/api/generate-document` | `app/api/generate-document/route.js` | Render LOR/ILA from template + claim data; save to `generated_documents`. |
| GET, POST | `/api/gipsa-rates` | `app/api/gipsa-rates/route.js` | Read/append `gipsa_fee_schedule` rows. |
| GET | `/api/gmail/auth` | `app/api/gmail/auth/route.js` | Start Gmail OAuth flow. |
| GET | `/api/gmail/callback` | `app/api/gmail/callback/route.js` | OAuth callback → upsert `gmail_tokens`. |
| GET | `/api/gmail/messages` | `app/api/gmail/messages/route.js` | List Gmail messages with tokens. |
| GET, DELETE | `/api/gmail/status` | `app/api/gmail/status/route.js` | Check / disconnect Gmail token. |
| POST, GET | `/api/gmail/tag` | `app/api/gmail/tag/route.js` | Tag an email into `claim_emails` (+ inserts attachments into `claim_documents`). |
| GET, POST | `/api/global-chat` | `app/api/global-chat/route.js` | Global chat messages CRUD; writes `activity_log`; mirrors claim-tagged messages into `claim_messages`. |
| GET, POST | `/api/global-chat-unread` | `app/api/global-chat-unread/route.js` | Compute unread mention counts; mark-read. |
| GET, POST | `/api/unread-mentions` | `app/api/unread-mentions/route.js` | Per-claim unread mention counts / mark-read. |
| GET | `/api/user-monitoring` | `app/api/user-monitoring/route.js` | Aggregated user activity stats. |
| GET, POST | `/api/surveyors` | `app/api/surveyors/route.js` | Reads/inserts `surveyors` table (NOT defined in any migration — orphan). |
| GET, POST | `/api/survey-fee-bills` | `app/api/survey-fee-bills/route.js` | List/create survey-fee bills; bumps `bill_counters`; patches claim. |
| GET, POST | `/api/activity-log` | `app/api/activity-log/route.js` | List/create activity_log entries. |
| GET | `/api/backup` | `app/api/backup/route.js` | JSON dump of multiple tables for download. |
| GET, POST, PUT, DELETE | `/api/ew-claims` | `app/api/ew-claims/route.js` | CRUD of `ew_vehicle_claims`; also creates parent `claims` row and seeds `ew_claim_stages`. |
| GET, PUT | `/api/ew-claim-stages` | `app/api/ew-claim-stages/route.js` | Per-stage update for EW claims. |
| GET, POST, DELETE | `/api/ew-claim-media` | `app/api/ew-claim-media/route.js` | Photo/video/document media uploads per EW stage (file-server). |
| GET, POST, PUT | `/api/ew-document-categories` | `app/api/ew-document-categories/route.js` | Admin-edit `ew_document_categories`. |
| POST | `/api/ew-fsr-generate` | `app/api/ew-fsr-generate/route.js` | Render EW FSR HTML from `fsr_templates` + claim. |
| POST | `/api/ew-fsr-save` | `app/api/ew-fsr-save/route.js` | Save generated FSR to the claim folder on file server. |
| GET, POST, PUT, DELETE | `/api/ew-lots` | `app/api/ew-lots/route.js` | CRUD over `ew_lots` + `ew_lot_claims` + counters + claim tagging. |
| GET | `/api/ew-lots/[id]/excel` | `app/api/ew-lots/[id]/excel/route.js` | Generate XLSX invoice for a lot. |
| GET, POST, PUT | `/api/fsr-templates` | `app/api/fsr-templates/route.js` | CRUD over `fsr_templates` (company-level FSR branding). |
| GET, POST | `/api/ai/analyze` | `app/api/ai/analyze/route.js` | AI document-analysis prompt; logs into `claim_ai_conversations`. |
| POST | `/api/ai/chat` | `app/api/ai/chat/route.js` | AI chat message relay with conversation persistence. |
| GET, DELETE | `/api/ai/conversations` | `app/api/ai/conversations/route.js` | Fetch/clear AI conversation history for a claim. |
| GET, PUT | `/api/ai/fsr-drafts` | `app/api/ai/fsr-drafts/route.js` | List/approve AI FSR drafts. |
| POST | `/api/ai/generate-fsr` | `app/api/ai/generate-fsr/route.js` | AI-driven FSR draft generation (inserts into `claim_fsr_drafts`). |

---

## 2. Supabase Tables

### 2.1 Consolidated Schema

Consolidation applies SQL in this order: `schema.sql` → `migration_v2.sql` → `migration_v3.sql` → `migration_v4_development_mode.sql` → `migration_v5_user_management_lor_ila.sql` → `migration_v6_development_sample_data.sql` → `migration_v7_assignments_activity.sql` → `migration_v8_activity_log_columns.sql` → `migration_v9_broker_master_claim_lifecycle.sql` → `migration_v10_claim_documents_gmail.sql` → `migration_v11_chat_user_monitoring.sql` → `migration_v12_chat_mentions.sql` → `migration_v13_global_chat.sql` → `migration_v14_ew_vehicle_claims.sql` → `migration_v15_ew_unique_ref_number.sql` → `migration_fix_inconsistencies.sql` → `migration_claim_categories.sql` → `migration_claim_categories_text_fields.sql` → `migration_seed_level4_and_ew_overhaul.sql` → `migration_ew_stages_12_to_8.sql` → `migration_ew_documents_and_logging.sql` → `migration_pipeline_stages.sql` → `migration_team_assignments.sql` → `migration_ai_features.sql` → `migration_fsr_templates.sql` → `migration_ew_lots.sql` → `migration_ew_claims_lot_number.sql` → `fix_duplicate_doc_categories.sql`.

Note: `migration_v10_claim_documents_gmail.sql` uses `UUID` PK + `claims(id)` UUID FK which does NOT match the base `claims.id BIGSERIAL` from `schema.sql`. The final consolidated shape of `claim_documents` follows v5 (BIGSERIAL, `generated_from_template` column) because v5 runs before v10; v10's `CREATE TABLE IF NOT EXISTS claim_documents` is a no-op. The Gmail-specific columns it proposes (`file_name`, `file_type`, `storage_path`, `mime_type`, `uploaded_by`, `source`, `gmail_*`, `company`) are NOT added by v10 in practice unless the migration was run on a clean DB.

#### insurers
Purpose: Master list of insurer companies.
Columns:
| name | type | constraints | default | notes |
|------|------|-------------|---------|-------|
| id | BIGSERIAL | PRIMARY KEY | | |
| code | TEXT | | | |
| company_name | TEXT | NOT NULL | | |
| registered_address | TEXT | | | |
| city | TEXT | | | |
| state | TEXT | | | |
| pin | TEXT | | | |
| phone | TEXT | | | |
| email | TEXT | | | |
| status | TEXT | | 'Active' | |
| created_at | TIMESTAMPTZ | | NOW() | |
| gstin | TEXT | | | added v3 |

Indexes: none beyond PK.
Foreign keys: none.

#### insurer_offices
Purpose: Regional / branch / LCBO offices per insurer.
Columns:
| name | type | constraints | default | notes |
|------|------|-------------|---------|-------|
| id | BIGSERIAL | PRIMARY KEY | | |
| insurer_id | BIGINT | REFERENCES insurers(id) ON DELETE CASCADE | | |
| type | TEXT | NOT NULL | | RO/DO/LCBO |
| name | TEXT | NOT NULL | | |
| address | TEXT | | | |
| city | TEXT | | | |
| created_at | TIMESTAMPTZ | | NOW() | |
| gstin | TEXT | | | added v3 |
| state | TEXT | | | added v3 |
| pin | TEXT | | | added v3 |
| phone | TEXT | | | added v3 |
| email | TEXT | | | added v3 |
| contact_person | TEXT | | | added v3 |

Indexes: none.
Foreign keys: insurer_id → insurers.id.

#### policy_types
Purpose: Seed of allowed policy_type values per LOB.
Columns:
| name | type | constraints | default | notes |
|------|------|-------------|---------|-------|
| id | BIGSERIAL | PRIMARY KEY | | |
| lob | TEXT | NOT NULL | | |
| policy_type | TEXT | NOT NULL | | |

Indexes: UNIQUE(lob, policy_type).
Foreign keys: none.

#### policies
Purpose: Policy master.
Columns:
| name | type | constraints | default | notes |
|------|------|-------------|---------|-------|
| id | BIGSERIAL | PRIMARY KEY | | |
| policy_number | TEXT | NOT NULL UNIQUE | | |
| insurer | TEXT | | | |
| insured_name | TEXT | | | |
| insured_address | TEXT | | | |
| city | TEXT | | | |
| phone | TEXT | | | |
| email | TEXT | | | |
| lob | TEXT | | | |
| policy_type | TEXT | | | |
| sum_insured | TEXT | | | |
| premium | TEXT | | | |
| start_date | TEXT | | | |
| end_date | TEXT | | | |
| policy_copy_url | TEXT | | | |
| created_at | TIMESTAMPTZ | | NOW() | |
| company | TEXT | | 'NISLA' | added v2 |
| risk_location | TEXT | | | added v2 |
| coverage_amount | NUMERIC | | | added v2 |
| description | TEXT | | | added v2 |
| folder_path | TEXT | | | added v3 |

Indexes: UNIQUE(policy_number).
Foreign keys: none.

#### claims
Purpose: Central claims table.
Columns:
| name | type | constraints | default | notes |
|------|------|-------------|---------|-------|
| id | BIGSERIAL | PRIMARY KEY | | |
| lob | TEXT | NOT NULL | | |
| ref_number | TEXT | NOT NULL UNIQUE | | |
| policy_number | TEXT | | | |
| insurer_name | TEXT | | | |
| claim_number | TEXT | | | |
| appointing_insurer | TEXT | | | |
| policy_type | TEXT | | | |
| date_of_intimation | TEXT | | | renamed from date_intimation in fix_inconsistencies |
| date_loss | TEXT | | | |
| insured_name | TEXT | | | |
| loss_location | TEXT | | | |
| gross_loss | NUMERIC | | | |
| assessed_loss | NUMERIC | | | |
| date_survey | TEXT | | | |
| place_survey | TEXT | | | |
| date_lor | TEXT | | | |
| date_fsr | TEXT | | | |
| date_submission | TEXT | | | |
| status | TEXT | | 'Open' | |
| remark | TEXT | | | |
| client_category | TEXT | | | |
| vessel_name | TEXT | | | |
| consignor | TEXT | | | |
| consignee | TEXT | | | |
| chassis_number | TEXT | | | |
| model_spec | TEXT | | | |
| dealer_name | TEXT | | | |
| lot_number | TEXT | | | |
| md_ref_number | TEXT | | | |
| created_at | TIMESTAMPTZ | | NOW() | |
| company | TEXT | | 'NISLA' | v2 |
| folder_path | TEXT | | | v2 |
| survey_fee_bill_number | TEXT | | | v3 |
| survey_fee_bill_date | TEXT | | | v3 |
| survey_fee_bill_amount | NUMERIC | | | v3 |
| survey_fee_payment_date | TEXT | | | v3 |
| broker_id | BIGINT | REFERENCES brokers(id) | | v9 |
| broker_name | TEXT | | | v9 |
| assigned_to | TEXT | | | v9 |
| appointing_office_id | bigint | | | fix_inconsistencies |
| appointing_office_name | text | | | fix_inconsistencies |
| appointing_office_address | text | | | fix_inconsistencies |
| policy_office_id | bigint | | | fix_inconsistencies |
| policy_office_name | text | | | fix_inconsistencies |
| policy_office_address | text | | | fix_inconsistencies |
| fsr_office_id | bigint | | | fix_inconsistencies |
| fsr_office_name | text | | | fix_inconsistencies |
| fsr_office_address | text | | | fix_inconsistencies |
| lob_category_id | bigint | REFERENCES claim_categories(id) | | claim_categories |
| policy_type_category_id | bigint | REFERENCES claim_categories(id) | | claim_categories |
| cause_of_loss_id | bigint | REFERENCES claim_categories(id) | | claim_categories |
| subject_matter_id | bigint | REFERENCES claim_categories(id) | | claim_categories |
| cause_of_loss | text | | | claim_categories_text_fields |
| subject_matter | text | | | claim_categories_text_fields |
| assigned_surveyor | text | | | seed_level4 |
| assigned_surveyor_name | text | | | seed_level4 |
| sla_due_date | date | | | seed_level4 |
| pipeline_stage | TEXT | | 'Pending Assignment' | pipeline_stages |
| pipeline_stage_number | INTEGER | | 1 | pipeline_stages |

Indexes: UNIQUE(ref_number); idx_claims_appointing_office; idx_claims_policy_office; idx_claims_fsr_office; idx_claims_lob_category; idx_claims_policy_type_category; idx_claims_pipeline_stage; idx_claims_pipeline_stage_number.
Foreign keys: broker_id → brokers.id; lob_category_id/policy_type_category_id/cause_of_loss_id/subject_matter_id → claim_categories.id.

#### ref_counters
Purpose: Per-LOB counter for ref-number generation.
Columns:
| name | type | constraints | default | notes |
|------|------|-------------|---------|-------|
| id | BIGSERIAL | PRIMARY KEY | | |
| lob | TEXT | NOT NULL UNIQUE | | |
| counter_value | INTEGER | | 0 | |

Indexes: UNIQUE(lob).
Foreign keys: none.

#### marine_counters
Purpose: Per-client category Marine ref counter.
Columns:
| name | type | constraints | default | notes |
|------|------|-------------|---------|-------|
| id | BIGSERIAL | PRIMARY KEY | | |
| client_category | TEXT | NOT NULL UNIQUE | | |
| counter_value | INTEGER | | 0 | |

Indexes: UNIQUE(client_category).
Foreign keys: none.

#### doc_types
Purpose: Seed reference of doc types per LOB.
Columns:
| name | type | constraints | default | notes |
|------|------|-------------|---------|-------|
| id | BIGSERIAL | PRIMARY KEY | | |
| lob | TEXT | NOT NULL | | |
| doc_type | TEXT | NOT NULL | | |

Indexes: UNIQUE(lob, doc_type).
Foreign keys: none.

#### gipsa_fee_schedule
Purpose: GIPSA fee slabs per LOB for survey-fee calculation.
Columns: id BIGSERIAL PK, lob TEXT NOT NULL, loss_range_min NUMERIC default 0, loss_range_max NUMERIC nullable, fee_percentage NUMERIC, min_fee NUMERIC, max_fee NUMERIC, flat_fee NUMERIC, description TEXT, is_custom BOOLEAN default false, company TEXT, created_at TIMESTAMPTZ default NOW().
Indexes: none.
Foreign keys: none.

#### survey_fee_bills
Purpose: Issued survey fee invoices.
Columns: id BIGSERIAL PK, bill_number TEXT NOT NULL UNIQUE, bill_date TEXT NOT NULL, claim_id BIGINT REFERENCES claims(id), ref_number TEXT, lob TEXT, insured_name TEXT, insurer_name TEXT, company TEXT default 'NISLA', loss_amount NUMERIC, fee_type TEXT default 'GIPSA', calculated_fee NUMERIC, gst_rate NUMERIC default 18, gst_amount NUMERIC, total_amount NUMERIC, payment_status TEXT default 'Pending', payment_date TEXT, payment_reference TEXT, remarks TEXT, created_at TIMESTAMPTZ default NOW().
Indexes: UNIQUE(bill_number).
Foreign keys: claim_id → claims.id.

#### bill_counters
Purpose: Counter per company for survey-fee bill numbering.
Columns: id BIGSERIAL PK, company TEXT NOT NULL UNIQUE, counter_value INTEGER default 0. Seeded with NISLA, Acuere, Development.
Indexes: UNIQUE(company).

#### app_users
Purpose: Login credentials for portal users.
Columns: id BIGSERIAL PK, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, name TEXT NOT NULL, role TEXT default 'Staff' (Admin/Surveyor/Staff), company TEXT default 'NISLA', is_active BOOLEAN default true, last_login TIMESTAMPTZ, created_at TIMESTAMPTZ default NOW(), last_active TIMESTAMPTZ (v11), total_claims_handled INTEGER default 0 (v11).
Indexes: UNIQUE(email).

#### claim_stages
Purpose: Lifecycle stage log for claims (pipeline progression).
Columns: id BIGSERIAL PK, claim_id BIGINT NOT NULL, stage TEXT NOT NULL, stage_date TEXT, notes TEXT, updated_by TEXT, created_at TIMESTAMPTZ default NOW(), stage_number INTEGER (pipeline_stages), entered_by TEXT (pipeline_stages), company TEXT default 'NISLA' (pipeline_stages).
Indexes: idx_claim_stages_claim_id, idx_claim_stages_stage, idx_claim_stages_stage_number.

#### claim_documents
Purpose: Documents per claim (LOR, ILA, appointment letter, photos, etc.).
Columns: id BIGSERIAL PK, claim_id BIGINT NOT NULL, document_type TEXT NOT NULL, document_name TEXT, status TEXT default 'Pending', file_url TEXT, generated_from_template BIGINT, remarks TEXT, created_at TIMESTAMPTZ default NOW(), updated_at TIMESTAMPTZ default NOW().
Indexes: idx_claim_documents_claim_id, idx_claim_documents_type.
Note: `migration_v10` tries to redefine as UUID with extra `gmail_*`/`source`/`file_name`/`storage_path` fields but v5's `IF NOT EXISTS` wins; v10's additional columns are not applied on top. API code (`gmail/tag`, `ai/analyze`, `ai/generate-fsr`) expects the v10 shape (`file_name`, `file_type`, `mime_type`, `source`, `gmail_message_id`).

#### document_templates
Purpose: LOR/ILA rich-text templates with placeholders.
Columns: id BIGSERIAL PK, name TEXT NOT NULL, type TEXT NOT NULL, lob TEXT, company TEXT default 'NISLA', content TEXT NOT NULL, placeholders TEXT, is_default BOOLEAN default false, is_active BOOLEAN default true, created_by TEXT, created_at TIMESTAMPTZ default NOW(), updated_at TIMESTAMPTZ default NOW().
Indexes: idx_document_templates_type, idx_document_templates_lob, idx_document_templates_company.

#### generated_documents
Purpose: Stored LOR/ILA/FSR output rows.
Columns: id BIGSERIAL PK, claim_id BIGINT NOT NULL, template_id BIGINT REFERENCES document_templates(id), type TEXT NOT NULL, title TEXT, content TEXT NOT NULL, pdf_url TEXT, lob TEXT, company TEXT default 'NISLA', generated_by TEXT, created_at TIMESTAMPTZ default NOW().
Indexes: idx_generated_documents_claim_id, idx_generated_documents_type, idx_generated_documents_company.
Foreign keys: template_id → document_templates.id.

#### activity_log
Purpose: Hub for user actions across the app.
Columns: id BIGSERIAL PK, user_email TEXT, action TEXT NOT NULL, entity_type TEXT, entity_id BIGINT, details TEXT, company TEXT, created_at TIMESTAMPTZ default NOW(), user_name TEXT (v8), claim_id BIGINT (v8), ref_number TEXT (v8).
Indexes: idx_activity_log_user, idx_activity_log_action, idx_activity_log_entity, idx_activity_log_created (v7), idx_activity_log_company (v7), idx_activity_log_claim (v8).

#### claim_assignments
Purpose: Team member assignments per claim.
Columns: id BIGSERIAL PK, claim_id BIGINT NOT NULL, assigned_to TEXT NOT NULL, assigned_by TEXT, role TEXT default 'Surveyor', status TEXT default 'Assigned', notes TEXT, assigned_date DATE (changed from TEXT in fix_inconsistencies), due_date DATE, completed_date DATE, company TEXT default 'NISLA', created_at TIMESTAMPTZ default NOW(), updated_at TIMESTAMPTZ default NOW(), assignment_type TEXT default 'general' (team_assignments), priority TEXT default 'Normal' (team_assignments), assignment_basis TEXT (team_assignments), location_of_loss TEXT (team_assignments), target_inspection_date DATE (team_assignments), target_report_date DATE (team_assignments), reassignment_reason TEXT (team_assignments), assigned_to_name TEXT (team_assignments).
Indexes: idx_claim_assignments_claim, idx_claim_assignments_user, idx_claim_assignments_company, idx_claim_assignments_status, idx_claim_assignments_type, idx_claim_assignments_priority, idx_claim_assignments_assigned_to.

#### brokers
Purpose: Broker master.
Columns: id BIGSERIAL PK, broker_name TEXT NOT NULL, contact_person TEXT, phone TEXT, email TEXT, address TEXT, city TEXT, state TEXT, gst_number TEXT, license_number TEXT, status TEXT default 'Active', company TEXT default 'NISLA', created_at TIMESTAMPTZ default NOW().
Indexes: idx_brokers_name, idx_brokers_company.

#### claim_workflow
Purpose: Workflow stages per claim with TAT tracking.
Columns: id BIGSERIAL PK, claim_id BIGINT NOT NULL, ref_number TEXT, stage_number INT NOT NULL, stage_name TEXT NOT NULL, status TEXT default 'Pending', due_date DATE, completed_date TIMESTAMPTZ, assigned_to TEXT, assigned_by TEXT, comments TEXT, tat_days INT, tat_from TEXT, is_tat_breached BOOLEAN default FALSE, company TEXT default 'NISLA', created_at TIMESTAMPTZ default NOW(), updated_at TIMESTAMPTZ default NOW().
Indexes: idx_claim_workflow_claim, idx_claim_workflow_status, idx_claim_workflow_assigned, idx_claim_workflow_breach, idx_claim_workflow_due.

#### claim_workflow_history
Purpose: Action history for workflow stages (comments, reassignments, status changes).
Columns: id BIGSERIAL PK, workflow_id BIGINT REFERENCES claim_workflow(id), claim_id BIGINT NOT NULL, action TEXT NOT NULL, user_email TEXT, user_name TEXT, details TEXT, old_value TEXT, new_value TEXT, created_at TIMESTAMPTZ default NOW().
Indexes: idx_cwh_workflow, idx_cwh_claim.
Foreign keys: workflow_id → claim_workflow.id.

#### claim_reminders
Purpose: Auto-generated and manual reminder entries per claim.
Columns: id BIGSERIAL PK, claim_id BIGINT NOT NULL, ref_number TEXT, reminder_type TEXT NOT NULL, due_date DATE, sent_date DATE, status TEXT default 'Pending', sent_to TEXT, sent_by TEXT, notes TEXT, company TEXT default 'NISLA', created_at TIMESTAMPTZ default NOW().
Indexes: idx_reminders_claim, idx_reminders_status, idx_reminders_due.

#### gmail_tokens
Purpose: Per-user Gmail OAuth tokens.
Columns: id UUID default gen_random_uuid() PK, user_email TEXT NOT NULL UNIQUE, access_token TEXT, refresh_token TEXT, token_expiry TIMESTAMPTZ, gmail_address TEXT, created_at TIMESTAMPTZ default NOW(), updated_at TIMESTAMPTZ default NOW().
Indexes: UNIQUE(user_email).
Note: defined in `migration_v10_claim_documents_gmail.sql` (the root-level v10, not under `supabase/`). Actually created despite the inconsistent `claim_documents` there.

#### claim_emails
Purpose: Emails tagged to claims.
Columns: id UUID default gen_random_uuid() PK, claim_id UUID REFERENCES claims(id) ON DELETE CASCADE, ref_number TEXT, gmail_message_id TEXT NOT NULL, gmail_thread_id TEXT, subject TEXT, sender TEXT, recipients TEXT, email_date TIMESTAMPTZ, snippet TEXT, has_attachments BOOLEAN default FALSE, tagged_by TEXT, company TEXT default 'NISLA', created_at TIMESTAMPTZ default NOW().
Indexes: idx_claim_emails_claim_id.
Note: claim_id is declared as UUID referencing claims(id) but `claims.id` is BIGSERIAL — this FK clause fails in practice on a real DB; either the migration errors out or runs after an `IF NOT EXISTS` that silences creation. API code (`gmail/tag`) uses it with the claim_id passed as-is.

#### claim_messages
Purpose: Per-claim chat messages.
Columns: id BIGSERIAL PK, claim_id BIGINT NOT NULL, ref_number TEXT, sender_email TEXT NOT NULL, sender_name TEXT NOT NULL, message TEXT NOT NULL, message_type TEXT default 'text', is_internal BOOLEAN default true, parent_id BIGINT, attachments TEXT, is_read_by TEXT default '[]', company TEXT default 'NISLA', created_at TIMESTAMPTZ default NOW(), mentioned_users TEXT default '[]' (v12).
Indexes: idx_claim_messages_claim, idx_claim_messages_sender, idx_claim_messages_created, idx_claim_messages_company, idx_claim_messages_mentions (GIN).

#### user_sessions
Purpose: Session tracker (login/logout).
Columns: id BIGSERIAL PK, user_email TEXT NOT NULL, user_name TEXT, login_at TIMESTAMPTZ default NOW(), logout_at TIMESTAMPTZ, ip_address TEXT, user_agent TEXT, company TEXT default 'NISLA', created_at TIMESTAMPTZ default NOW().
Indexes: idx_user_sessions_email, idx_user_sessions_login, idx_user_sessions_company.

#### message_reads
Purpose: Per-user message read receipts for claim chat.
Columns: id BIGSERIAL PK, message_id BIGINT NOT NULL REFERENCES claim_messages(id) ON DELETE CASCADE, user_email TEXT NOT NULL, read_at TIMESTAMPTZ default NOW(), UNIQUE(message_id, user_email).
Indexes: idx_message_reads_user, idx_message_reads_message.
Foreign keys: message_id → claim_messages.id.

#### global_chat_messages
Purpose: Portal-wide chat feed with mentions and file-tagging.
Columns: id BIGSERIAL PK, sender_email TEXT NOT NULL, sender_name TEXT NOT NULL, message TEXT NOT NULL, mentioned_users TEXT default '[]', tagged_ref_numbers TEXT default '[]', company TEXT default 'NISLA', created_at TIMESTAMPTZ default NOW().
Indexes: idx_global_chat_company, idx_global_chat_created (DESC), idx_global_chat_mentions (GIN).

#### global_chat_reads
Purpose: Per-user read receipts for global chat.
Columns: id BIGSERIAL PK, message_id BIGINT NOT NULL REFERENCES global_chat_messages(id) ON DELETE CASCADE, user_email TEXT NOT NULL, read_at TIMESTAMPTZ default NOW(), UNIQUE(message_id, user_email).
Indexes: idx_global_chat_reads_user, idx_global_chat_reads_message.
Foreign keys: message_id → global_chat_messages.id.

#### ew_vehicle_claims
Purpose: EW-specific claim rows (extends `claims` via optional `claim_id`).
Columns: id UUID default gen_random_uuid() PK, claim_id UUID REFERENCES claims(id) ON DELETE SET NULL, ref_number TEXT, company TEXT default 'NISLA', report_date DATE, insured_name TEXT, insured_address TEXT, insurer_name TEXT, insurer_address TEXT, policy_number TEXT, claim_file_no TEXT, person_contacted TEXT, estimated_loss_amount NUMERIC(12,2), date_of_intimation DATE, customer_name TEXT, vehicle_reg_no TEXT, date_of_registration DATE, vehicle_make TEXT, model_fuel_type TEXT, chassis_number TEXT, engine_number TEXT, odometer_reading TEXT, warranty_plan TEXT, certificate_no TEXT, certificate_from DATE, certificate_to DATE, certificate_kms TEXT, certificate_validity_text TEXT, product_description TEXT, terms_conditions TEXT, dealer_name TEXT, dealer_address TEXT, dealer_contact TEXT, customer_complaint TEXT, complaint_date DATE, survey_date DATE, survey_location TEXT, initial_observation TEXT, dismantled_observation TEXT, defective_parts TEXT, external_damages TEXT default 'No external damages were found.', service_history_verified BOOLEAN default true, reinspection_date DATE, reinspection_notes TEXT, tax_invoice_no TEXT, tax_invoice_date DATE, tax_invoice_amount NUMERIC(12,2), dealer_invoice_name TEXT, gross_assessed_amount NUMERIC(12,2), gst_amount NUMERIC(12,2), total_after_gst NUMERIC(12,2), not_covered_amount NUMERIC(12,2) default 0, net_adjusted_amount NUMERIC(12,2), amount_in_words TEXT, conclusion_text TEXT (seeded default), current_stage INTEGER default 1, current_stage_name TEXT default 'Claim Intimation', status TEXT default 'Open' CHECK IN (Open/In Progress/Assessment/Report Ready/Completed/Closed), created_by TEXT, assigned_to TEXT, created_at TIMESTAMPTZ default NOW(), updated_at TIMESTAMPTZ default NOW(), appointing_office_id bigint (fix_inconsistencies), appointing_office_name text, appointing_office_address text, policy_office_id bigint, policy_office_name text, policy_office_address text, fsr_office_id bigint, fsr_office_name text, fsr_office_address text, assigned_surveyor text (seed_level4), assigned_surveyor_name text, sla_due_date date, folder_path text (ew_documents_and_logging), fsr_generated_at TIMESTAMPTZ (ew_lots), lot_id BIGINT REFERENCES ew_lots(id) ON DELETE SET NULL (ew_claims_lot_number), lot_number TEXT.
Indexes: idx_ew_vehicle_claims_company, _status, _ref, _claim_id, idx_ew_appointing_office, _policy_office, _fsr_office, idx_ew_claims_surveyor, _sla, idx_ew_vehicle_claims_fsr_generated_at, _lot_id, _lot_number, idx_ew_vehicle_claims_ref_number (company, ref_number). UNIQUE(company, ref_number) as constraint `ew_vehicle_claims_company_ref_unique`.
Foreign keys: claim_id → claims.id (declared UUID but claims.id is BIGSERIAL — FK mismatch, see claim_emails); lot_id → ew_lots.id.

#### ew_claim_stages
Purpose: Per-stage rows for EW claim lifecycle (now 8-stage after migration_ew_stages_12_to_8).
Columns: id UUID default gen_random_uuid() PK, ew_claim_id UUID REFERENCES ew_vehicle_claims(id) ON DELETE CASCADE, stage_number INTEGER NOT NULL, stage_name TEXT NOT NULL, status TEXT default 'Pending' CHECK IN (Pending/In Progress/Completed/Skipped), started_date TIMESTAMPTZ, completed_date TIMESTAMPTZ, notes TEXT, updated_by TEXT, created_at TIMESTAMPTZ default NOW(), updated_at TIMESTAMPTZ default NOW(), due_date date (seed_level4).
Indexes: idx_ew_claim_stages_claim, idx_ew_stages_due.
Foreign keys: ew_claim_id → ew_vehicle_claims.id.

#### ew_claim_media
Purpose: Photos/videos/documents attached to EW claim/stage.
Columns: id UUID default gen_random_uuid() PK, ew_claim_id UUID REFERENCES ew_vehicle_claims(id) ON DELETE CASCADE, stage_number INTEGER, media_type TEXT CHECK IN (photo/video/document), file_name TEXT, file_url TEXT, file_size INTEGER, caption TEXT, uploaded_by TEXT, created_at TIMESTAMPTZ default NOW(), document_category text (ew_documents_and_logging), category_id bigint, subfolder text.
Indexes: idx_ew_claim_media_claim.
Foreign keys: ew_claim_id → ew_vehicle_claims.id.

#### ew_document_categories
Purpose: Admin-editable list of EW document buckets (Intimation/Policy Copy/FSR/etc.).
Columns: id BIGSERIAL PK, name text NOT NULL, code text NOT NULL, subfolder_name text NOT NULL, sort_order int default 0, is_active boolean default true, created_at timestamptz default now().
Indexes: none beyond PK. `fix_duplicate_doc_categories.sql` dedupes by code.

#### claim_categories
Purpose: Hierarchical taxonomy (LOB → Policy Type → Cause → Subject Matter).
Columns: id bigserial PK, parent_id bigint REFERENCES claim_categories(id) ON DELETE CASCADE, name text NOT NULL, level int NOT NULL, level_label text, code text, icon text, color text, sort_order int default 0, is_active boolean default true, metadata jsonb default '{}', created_at timestamptz default now().
Indexes: idx_claim_categories_parent, idx_claim_categories_level.
Foreign keys: parent_id → claim_categories.id (self).

#### claim_ai_conversations
Purpose: Per-claim AI chat history for analyser.
Columns: id bigserial PK, claim_id bigint NOT NULL, role text NOT NULL, message text NOT NULL, created_by text, created_at timestamptz default now().
Indexes: idx_ai_conv_claim, idx_ai_conv_created.

#### claim_fsr_drafts
Purpose: AI-generated FSR draft rows awaiting review.
Columns: id bigserial PK, claim_id bigint NOT NULL, lob text, draft_content text, status text default 'draft', version_number int default 1, generated_at timestamptz default now(), approved_by text, approved_at timestamptz.
Indexes: idx_fsr_drafts_claim.

#### fsr_templates
Purpose: Per-company FSR template with branding + section-title overrides.
Columns: id bigserial PK, company text NOT NULL, template_name text default 'Default', company_full_name text, company_short_name text, sla_number text, sla_expiry text, tagline text, brand_color text default '#4B0082', address_line text, contact_line text, cover_title text default 'EXTENDED WARRANTY REPORT', section1_title text default '1. CLAIM DETAILS:', section2_title default '2. CERTIFICATE / VEHICLE PARTICULARS:', section3_title default '3. OUR SURVEY / INSPECTION / FINDINGS:', section4_title default '4. ASSESSMENT OF LOSS:', section5_title default '5. CONCLUSION:', cover_letter_opening text, cover_letter_closing text, conclusion_text text, note1_text text, note2_text text, note3_text text, signature_text text default 'Authorised Signatory', assessment_label_gross/gst/total/not_covered/net text, font_family text default 'Times New Roman, Times, serif', font_size text default '11pt', logo_base64 text, is_active boolean default true, created_at timestamptz default now(), updated_at timestamptz default now().
Indexes: idx_fsr_templates_company.

#### ew_lots
Purpose: Parent lot record that bundles EW claims for an invoice package.
Columns: id BIGSERIAL PK, lot_number TEXT NOT NULL, company TEXT NOT NULL default 'NISLA', lot_date DATE default CURRENT_DATE, ew_program TEXT, insurer_name TEXT, surveyor_name TEXT, notes TEXT, claim_count INTEGER default 0, total_professional_fee NUMERIC(12,2) default 0, total_reinspection NUMERIC(12,2), total_conveyance NUMERIC(12,2), total_photographs NUMERIC(12,2), total_bill NUMERIC(12,2), total_gst NUMERIC(12,2), total_amount NUMERIC(12,2), status TEXT default 'Draft' CHECK IN (Draft/Finalized/Invoiced/Paid), created_by TEXT, created_at TIMESTAMPTZ default NOW(), updated_at TIMESTAMPTZ default NOW(), UNIQUE(company, lot_number).
Indexes: idx_ew_lots_company, _status, _lot_date DESC.

#### ew_lot_claims
Purpose: Lot line items — snapshot copy of an EW claim + fee breakdown at lot time.
Columns: id BIGSERIAL PK, lot_id BIGINT NOT NULL REFERENCES ew_lots(id) ON DELETE CASCADE, ew_claim_id UUID NOT NULL REFERENCES ew_vehicle_claims(id) ON DELETE CASCADE, position INTEGER default 0, ref_number TEXT, claim_file_no TEXT, policy_number TEXT, insured_name TEXT, customer_name TEXT, vehicle_reg_no TEXT, chassis_number TEXT, vehicle_make TEXT, vehicle_model TEXT, date_of_intimation DATE, date_of_loss DATE, report_date DATE, estimated_loss_amount NUMERIC(12,2), gross_assessed_amount NUMERIC(12,2), net_adjusted_amount NUMERIC(12,2), admissibility TEXT, location TEXT, workshop_name TEXT, breakdown_details TEXT, service_request_number TEXT, professional_fee NUMERIC(12,2) default 0, reinspection_fee NUMERIC(12,2), conveyance NUMERIC(12,2), photographs NUMERIC(12,2), total_bill NUMERIC(12,2), gst NUMERIC(12,2), total_amount NUMERIC(12,2), created_at TIMESTAMPTZ default NOW(), updated_at TIMESTAMPTZ default NOW(), UNIQUE(lot_id, ew_claim_id).
Indexes: idx_ew_lot_claims_lot, _claim.
Foreign keys: lot_id → ew_lots.id, ew_claim_id → ew_vehicle_claims.id.

#### ew_lot_counters
Purpose: Per-company auto-increment for lot_number.
Columns: company TEXT PRIMARY KEY, current_count INTEGER default 0, updated_at TIMESTAMPTZ default NOW().
Seeded with NISLA, Acuere.

Triggers: `trg_clear_ew_claim_lot_number_on_lot_delete` (BEFORE DELETE on ew_lots → null out lot_number on related claims); `trg_sync_ew_claim_lot_number_on_lot_update` (AFTER UPDATE OF lot_number on ew_lots → propagate new lot_number to claims).

### 2.2 Table Usage Matrix

| Table | Written by (files) | Read by (files) |
|-------|--------------------|-----------------|
| activity_log | `app/api/activity-log/route.js`, `app/api/auth/login/route.js`, `app/api/claim-messages/route.js`, `app/api/claim-stages/route.js`, `app/api/ew-claims/route.js`, `app/api/ew-lots/route.js`, `app/api/global-chat/route.js` (via activityLogger helper → `app/api/activity-log/route.js`: called from many pages through `lib/activityLogger.js`) | `app/api/activity-log/route.js`, `app/api/user-monitoring/route.js` |
| app_users | `app/api/auth/login/route.js` (update last_login), `app/api/auth/users/route.js`, `app/api/auth/users/[id]/route.js` | `app/api/auth/login/route.js`, `app/api/auth/users/route.js`, `app/api/auth/users/[id]/route.js`, `app/api/user-monitoring/route.js` |
| bill_counters | `app/api/survey-fee-bills/route.js` (update counter) | `app/api/survey-fee-bills/route.js` |
| brokers | `app/api/brokers/route.js`, `app/api/brokers/[id]/route.js` | `app/api/brokers/route.js`, `app/api/brokers/[id]/route.js` |
| claim_ai_conversations | `app/api/ai/analyze/route.js`, `app/api/ai/chat/route.js`, `app/api/ai/conversations/route.js` (DELETE) | `app/api/ai/generate-fsr/route.js`, `app/api/ai/chat/route.js`, `app/api/ai/conversations/route.js` |
| claim_assignments | `app/api/claim-assignments/route.js`, `app/api/claim-assignments/[id]/route.js` | `app/api/claim-assignments/route.js`, `app/api/claim-assignments/[id]/route.js`, `app/api/user-monitoring/route.js` |
| claim_categories | `app/api/claim-categories/route.js` | `app/api/claim-categories/route.js` |
| claim_documents | `app/api/claim-documents/route.js`, `app/api/claim-documents/[id]/route.js`, `app/api/generate-document/route.js`, `app/api/gmail/tag/route.js` | `app/api/claim-documents/route.js`, `app/api/claim-documents/[id]/route.js`, `app/api/ai/generate-fsr/route.js`, `app/api/ai/analyze/route.js` |
| claim_emails | `app/api/gmail/tag/route.js` | `app/api/gmail/tag/route.js` |
| claim_fsr_drafts | `app/api/ai/generate-fsr/route.js`, `app/api/ai/fsr-drafts/route.js` (PUT approve) | `app/api/ai/generate-fsr/route.js`, `app/api/ai/fsr-drafts/route.js` |
| claim_messages | `app/api/claim-messages/route.js`, `app/api/global-chat/route.js` (mirrors mentions) | `app/api/claim-messages/route.js`, `app/api/unread-mentions/route.js`, `app/api/user-monitoring/route.js` |
| claim_reminders | `app/api/claim-reminders/route.js` | `app/api/claim-reminders/route.js` |
| claim_stages | `app/api/claim-stages/route.js`, `app/api/claims/route.js` (seeds initial stage) | `app/api/claim-stages/route.js` |
| claim_workflow | `app/api/claim-workflow/route.js`, `app/api/claim-workflow/[id]/route.js` | `app/api/claim-workflow/route.js`, `app/api/claim-workflow/[id]/route.js`, `app/api/dashboard-stats/route.js` |
| claim_workflow_history | `app/api/claim-workflow-history/route.js`, `app/api/claim-workflow/[id]/route.js` | `app/api/claim-workflow-history/route.js` |
| claims | `app/api/claims/route.js`, `app/api/claims/[id]/route.js`, `app/api/survey-fee-bills/route.js` (update fee columns), `app/api/policies/[id]/upload-copy/route.js` | `app/api/claims/route.js`, `app/api/claims/[id]/route.js`, `app/api/ai/analyze/route.js`, `app/api/ai/chat/route.js`, `app/api/ai/generate-fsr/route.js`, `app/api/documents/[claimId]/route.js`, `app/api/export-excel/route.js`, `app/api/ew-claim-media/route.js`, `app/api/generate-document/route.js`, `app/api/global-chat/route.js`, `app/api/dashboard-stats/route.js`, `app/api/ew-fsr-save/route.js`, `app/api/ew-claims/route.js` |
| doc_types | (none) | (none) |
| document_templates | `app/api/document-templates/route.js`, `app/api/document-templates/[id]/route.js` | `app/api/document-templates/route.js`, `app/api/document-templates/[id]/route.js`, `app/api/generate-document/route.js` |
| ew_claim_media | `app/api/ew-claim-media/route.js` | `app/api/ew-claim-media/route.js` |
| ew_claim_stages | `app/api/ew-claim-stages/route.js`, `app/api/claims/route.js` (seeds when EW), `app/api/ew-claims/route.js` | `app/api/ew-claim-stages/route.js`, `app/api/ew-claims/route.js` |
| ew_document_categories | `app/api/ew-document-categories/route.js` | `app/api/ew-document-categories/route.js`, `app/api/ew-claim-media/route.js` |
| ew_lot_claims | `app/api/ew-lots/route.js` | `app/api/ew-lots/route.js`, `app/api/ew-lots/[id]/excel/route.js` |
| ew_lot_counters | `app/api/ew-lots/route.js` | `app/api/ew-lots/route.js` |
| ew_lots | `app/api/ew-lots/route.js` | `app/api/ew-lots/route.js`, `app/api/ew-lots/[id]/excel/route.js` |
| ew_vehicle_claims | `app/api/ew-claims/route.js`, `app/api/claims/route.js` (update when parent claim edited), `app/api/ew-fsr-save/route.js` (stamps fsr_generated_at), `app/api/ew-claim-stages/route.js` (update current_stage), `app/api/claims/[id]/route.js` (auto-create on LOB change), `app/api/ew-lots/route.js` (stamp lot_id / lot_number) | `app/api/ew-claims/route.js`, `app/api/ew-claim-media/route.js`, `app/api/ew-fsr-generate/route.js`, `app/api/ew-fsr-save/route.js`, `app/api/ew-lots/route.js`, `app/api/ai/generate-fsr/route.js` |
| fsr_templates | `app/api/fsr-templates/route.js` | `app/api/fsr-templates/route.js`, `app/api/ew-fsr-generate/route.js` |
| generated_documents | `app/api/generate-document/route.js` | `app/api/generate-document/route.js` |
| gipsa_fee_schedule | `app/api/gipsa-rates/route.js` | `app/api/gipsa-rates/route.js` |
| global_chat_messages | `app/api/global-chat/route.js` | `app/api/global-chat/route.js`, `app/api/global-chat-unread/route.js` |
| global_chat_reads | `app/api/global-chat-unread/route.js` | `app/api/global-chat-unread/route.js` |
| gmail_tokens | `app/api/gmail/callback/route.js`, `app/api/gmail/status/route.js` (DELETE) | `app/api/gmail/tag/route.js`, `app/api/gmail/status/route.js`, `app/api/gmail/messages/route.js`, `app/api/gmail/callback/route.js` |
| insurer_offices | `app/api/insurer-offices/[id]/route.js` | `app/api/insurer-offices/[id]/route.js`, `app/api/offices/route.js`, `app/api/insurers/route.js` (nested select) |
| insurers | `app/api/insurers/route.js`, `app/api/insurers/[id]/route.js` | `app/api/insurers/route.js`, `app/api/insurers/[id]/route.js`, `app/api/offices/route.js` |
| marine_counters | `app/api/claims/route.js`, `app/api/claims/[id]/route.js`, `app/api/ref-structure/reset/[lob]/route.js` | `app/api/claims/route.js`, `app/api/claims/[id]/route.js`, `app/api/ref-structure/route.js`, `app/api/ref-numbers/route.js`, `app/api/tentative-ref/[lob]/route.js` |
| message_reads | `app/api/unread-mentions/route.js` (insert), `app/api/unread-mentions/route.js` (delete) | `app/api/unread-mentions/route.js` |
| policies | `app/api/policies/route.js`, `app/api/policies/[id]/route.js`, `app/api/policies/[id]/upload-copy/route.js` | `app/api/policies/route.js`, `app/api/policies/[id]/route.js`, `app/api/policies/[id]/download-copy/route.js` |
| policy_types | `app/api/policy-types/route.js` | `app/api/policy-types/route.js`, `app/api/policy-types/[lob]/route.js` |
| ref_counters | `app/api/claims/route.js`, `app/api/claims/[id]/route.js`, `app/api/ew-claims/route.js`, `app/api/ref-structure/reset/[lob]/route.js` | `app/api/claims/route.js`, `app/api/claims/[id]/route.js`, `app/api/ew-claims/route.js`, `app/api/ref-structure/route.js`, `app/api/ref-numbers/route.js`, `app/api/tentative-ref/[lob]/route.js` |
| survey_fee_bills | `app/api/survey-fee-bills/route.js` | `app/api/survey-fee-bills/route.js` |
| surveyors | `app/api/surveyors/route.js` | `app/api/surveyors/route.js` |
| user_sessions | (none — schema only) | (none) |

Hub-table note: `activity_log` is effectively written to from dozens of pages indirectly via `lib/activityLogger.js` → `POST /api/activity-log`. For that reason it is excluded from "circular writer" flags in §6.

---

## 3. Forms

### /login
File: `app/login/page.js`
Fields captured:
- username (text) → ephemeral (POSTed to `/api/auth/login`)
- password (text/password) → ephemeral
- showPassword (bool) → ephemeral

### /user-management
File: `app/user-management/page.js`
Fields captured:
- name (text) → app_users.name
- email (email) → app_users.email
- password (password) → app_users.password_hash (plain-text on insert; the schema hashes nominally)
- role (select: Admin/Surveyor/Staff) → app_users.role
- company (select) → app_users.company
- is_active (checkbox) → app_users.is_active

### /broker-master
File: `app/broker-master/page.js`
Fields captured:
- broker_name (text, required) → brokers.broker_name
- contact_person (text) → brokers.contact_person
- phone (text) → brokers.phone
- email (email) → brokers.email
- city (text) → brokers.city
- state (text) → brokers.state
- license_number (text) → brokers.license_number
- gst_number (text) → brokers.gst_number
- status (select: Active/Inactive) → brokers.status
- address (textarea) → brokers.address

### /insurer-master
File: `app/insurer-master/page.js`
Fields captured:
- Insurer form: company_name (text, required) → insurers.company_name; code → insurers.code; gstin → insurers.gstin; status → insurers.status; registered_address (textarea) → insurers.registered_address; city → insurers.city; state → insurers.state; pin (max 6) → insurers.pin; phone → insurers.phone; email → insurers.email.
- Office form (nested per insurer): type, name, address, city, state, pin, gstin, phone, email, contact_person → insurer_offices.*.

### /policy-master
File: `app/policy-master/page.js`
Fields captured:
- policy_number (text, required) → policies.policy_number
- insured_name (text, required) → policies.insured_name
- insurer (text/combobox, required) → policies.insurer
- insurer_office (select) → ephemeral (not persisted to policies; used for display only)
- lob (select) → policies.lob
- policy_type (combobox) → policies.policy_type
- start_date (date) → policies.start_date
- end_date (date) → policies.end_date
- sum_insured (number) → policies.sum_insured
- premium (number) → policies.premium
- risk_location (text) → policies.risk_location
- insured_address (text) → policies.insured_address
- city (text) → policies.city
- phone (text) → policies.phone
- email (email) → policies.email

### /policy-directory
File: `app/policy-directory/page.js`
Fields captured: read-only filter panel — filterInsurer, filterInsured, filterLob, filterPolicyNumber (all ephemeral).

### /claims/[lob]
File: `app/claims/[lob]/page.js`
Fields captured (large form, grouped logically):
- Identification: policy_number → claims.policy_number; ref_number (auto or manual) → claims.ref_number; tentative_ref → ephemeral
- Parties: insured_name (required) → claims.insured_name; insurer_name (select) → claims.insurer_name; claim_number → claims.claim_number; appointing_type → ephemeral; appointing_office → claims.appointing_office_* (via selectOfficeForRole); broker_name → claims.broker_name; broker_id → claims.broker_id
- Category: policy_type → claims.policy_type; cause_of_loss_id → claims.cause_of_loss_id; cause_of_loss (text) → claims.cause_of_loss; subject_matter_id → claims.subject_matter_id; subject_matter (text) → claims.subject_matter
- Assignment: surveyor_name → claims.assigned_surveyor; assigned_to (select) → claims.assigned_to
- Address/Details: insured_address → claims.insured_address (policy-master auto-fill); insurer_address → ephemeral; claim_file_no → claims.claim_number (?); person_contacted → ephemeral; estimated_loss_amount → ephemeral (stored on EW side)
- Dates: date_of_intimation (required) → claims.date_of_intimation; date_loss (required) → claims.date_loss; date_survey → claims.date_survey; date_lor → claims.date_lor; date_fsr → claims.date_fsr; date_submission → claims.date_submission
- Loss: loss_location (required) → claims.loss_location; place_survey → claims.place_survey; gross_loss (number) → claims.gross_loss; assessed_loss (number) → claims.assessed_loss
- Marine-only: client_category → claims.client_category; consignor → claims.consignor; consignee → claims.consignee; model_spec → claims.model_spec; chassis_number → claims.chassis_number; dealer_name → claims.dealer_name; lot_number → claims.lot_number; vessel_name → claims.vessel_name; md_ref_number → claims.md_ref_number
- Survey-fee: survey_fee_bill_number → claims.survey_fee_bill_number; survey_fee_bill_date → claims.survey_fee_bill_date; survey_fee_bill_amount (number) → claims.survey_fee_bill_amount; survey_fee_payment_date → claims.survey_fee_payment_date
- Status/Remark: status (select: Open/In Process/Submitted) → claims.status; remark (textarea) → claims.remark; folder_path (read-only display) → claims.folder_path
- Intimation-sheet upload field → pushed to file server + `claim_documents` insert

### /survey-fee-bill
File: `app/survey-fee-bill/page.js`
Fields captured:
- claim_id (select) → survey_fee_bills.claim_id
- bill_date (date) → survey_fee_bills.bill_date
- ref_number (text) → survey_fee_bills.ref_number
- lob (select) → survey_fee_bills.lob
- fee_type (select: GIPSA/Custom) → survey_fee_bills.fee_type
- insured_name (text) → survey_fee_bills.insured_name
- insurer_name (text) → survey_fee_bills.insurer_name
- loss_amount (number) → survey_fee_bills.loss_amount
- calculated_fee (number, if Custom) → survey_fee_bills.calculated_fee
- gst_rate (number) → survey_fee_bills.gst_rate
- remarks (textarea) → survey_fee_bills.remarks
- Calculator-widget inputs (lob, amount) → ephemeral (calls `calculatePreview`).

### /file-assignments
File: `app/file-assignments/page.js`
Fields captured:
- claim_id (select) → claim_assignments.claim_id
- assigned_to (select) → claim_assignments.assigned_to + assigned_to_name
- assignment_type (select: lead_surveyor/general/etc.) → claim_assignments.assignment_type
- priority (select) → claim_assignments.priority
- assignment_basis (select) → claim_assignments.assignment_basis
- location_of_loss (text) → claim_assignments.location_of_loss
- target_inspection_date (date) → claim_assignments.target_inspection_date
- target_report_date (date) → claim_assignments.target_report_date
- notes (textarea) → claim_assignments.notes

### /lor-ila-generator
File: `app/lor-ila-generator/page.js`
Fields captured:
- Template form: name, type (LOR/ILA/FSR/Custom), lob, content (rich text with `{{placeholder}}` tokens) → document_templates.*
- Generator: selectedClaim → ephemeral; selectedTemplate → ephemeral; editableContent (rich text) → `generated_documents.content` when saved; docType, previewContent → ephemeral.

### /claim-categories
File: `app/claim-categories/page.js`
Fields captured: editForm with name, level_label, code, icon, color, sort_order, is_active → claim_categories.*.

### /ew-vehicle-claims/register
File: `app/ew-vehicle-claims/register/page.js`
Fields captured (grouped):
- Claim: insured_name, insured_address, policy_number, claim_file_no, person_contacted, estimated_loss_amount, date_of_intimation, report_date, appointing_office_*/policy_office_*/fsr_office_* (triple office model) → ew_vehicle_claims.*
- Vehicle/Certificate: customer_name, vehicle_reg_no, date_of_registration, vehicle_make, model_fuel_type, chassis_number, engine_number, odometer_reading, warranty_plan, certificate_no, certificate_from, certificate_to, certificate_kms, certificate_validity_text, product_description, terms_conditions → ew_vehicle_claims.*
- Dealer: dealer_name, dealer_address, dealer_contact → ew_vehicle_claims.*
- Complaint: customer_complaint, complaint_date → ew_vehicle_claims.*

### /ew-vehicle-claims/[id]
File: `app/ew-vehicle-claims/[id]/page.js`
Fields captured (editForm across 5 data tabs plus media tab):
- Claim tab: ref_number, report_date, insured_name, insured_address, insurer_name, insurer_address, policy_number, claim_file_no, person_contacted, estimated_loss_amount, date_of_intimation → ew_vehicle_claims.*
- Vehicle tab: customer_name, vehicle_reg_no, date_of_registration, vehicle_make, model_fuel_type, chassis_number, engine_number, odometer_reading, warranty_plan, certificate_no, certificate_from, certificate_to, certificate_kms, certificate_validity_text, product_description, terms_conditions, dealer_name, dealer_contact, dealer_address, customer_complaint, complaint_date → ew_vehicle_claims.*
- Survey tab: survey_date, survey_location, initial_observation, dismantled_observation, defective_parts, external_damages, reinspection_date, reinspection_notes, tax_invoice_no, tax_invoice_date, tax_invoice_amount, dealer_invoice_name → ew_vehicle_claims.*
- Assessment tab: gross_assessed_amount, gst_amount, total_after_gst, not_covered_amount, net_adjusted_amount, amount_in_words → ew_vehicle_claims.*
- Conclusion tab: conclusion_text → ew_vehicle_claims.conclusion_text
- Media tab: caption, category_id, stage_number (multi-file upload) → ew_claim_media.*

### /ew-lots/new
File: `app/ew-lots/new/page.js`
Fields captured:
- lot_number (text; empty → auto) → ew_lots.lot_number
- lot_date (date) → ew_lots.lot_date
- ew_program (text) → ew_lots.ew_program
- insurer_name (text) → ew_lots.insurer_name
- notes (textarea) → ew_lots.notes
- Selected claims checklist → ew_lot_claims rows with fee breakdown (professional_fee, reinspection_fee, conveyance, photographs).

### /ew-lots/[id]
File: `app/ew-lots/[id]/page.js`
Fields captured: Edit form exposes same lot fields; allows per-row fee edits.

### /fsr-template-editor/ew-vehicle
File: `app/fsr-template-editor/ew-vehicle/page.js`
Fields captured: company, template_name, company_full_name, company_short_name, sla_number, sla_expiry, tagline, brand_color, address_line, contact_line, cover_title, section1–5_title, cover_letter_opening, cover_letter_closing, conclusion_text, note1_text, note2_text, note3_text, signature_text, assessment_label_gross/gst/total/not_covered/net, font_family, font_size, logo_base64 (file upload) → fsr_templates.*.

### /ref-number-portal
File: `app/ref-number-portal/page.js`
Fields captured: For each ref/marine counter, a numeric input to reset → ref_counters.counter_value / marine_counters.counter_value.

### /backup
File: `app/backup/page.js`
Fields captured: table (select), format (json/csv), company → ephemeral (triggers GET `/api/backup`).

### /activity-log
File: `app/activity-log/page.js`
Fields captured: search + filter panel (user_email, claim_id, ref_number, action, company, date range) → ephemeral.

### /user-monitoring
File: `app/user-monitoring/page.js`
Fields captured: read-only (no form inputs beyond optional filters).

### /workflow-overview
File: `app/workflow-overview/page.js`
Fields captured: Filter panel inputs (lob, status, assignment) → ephemeral.

### /file-tracking
File: `app/file-tracking/page.js`
Fields captured: Add-document form: document_type (select), document_name (text), status (select), file upload → claim_documents.*; claim_stages quick-toggle.

### /mis-portal
File: `app/mis-portal/page.js`
Fields captured: 14+ filter fields (filterLob/Status/Ref/Insurer/Insured/PolicyNumber/ClaimNumber/PolicyType/Pipeline/DateLossFrom/To/DateIntFrom/To/DateSubFrom/To/Company) → ephemeral (propagated to `/api/claims`).

### /ew-vehicle-claims/mis
File: `app/ew-vehicle-claims/mis/page.js`
Fields captured: filter panel (lot_number, surveyor, insurer, date, stage) → ephemeral.

### /claim-detail/[id]
File: `app/claim-detail/[id]/page.js`
Fields captured: read-only display with action buttons.

### /claim-lifecycle/[id]
File: `app/claim-lifecycle/[id]/page.js`
Fields captured: per-stage comment box, due-date input, status select → claim_workflow.* via PUT.

### /documents/[claimId]
File: `app/documents/[claimId]/page.js`
Fields captured: file upload (multiple), document_type (select) → claim_documents + Supabase Storage `documents` bucket.

### /claim-registration
File: `app/claim-registration/page.js`
Fields captured: just routing (LOB click) — no real form.

### / (dashboard)
File: `app/page.js`
Fields captured: filter inputs (dashFilterLob/Stage/Status) + pipeline-stage dropdown per claim-row → updates `claim_stages` via POST.

---

## 4. Duplication Report

### 4.1 Duplicate fields across tables

| Field | Tables it appears in | Notes (same meaning? stale copy? denormalised?) |
|-------|----------------------|--------------------------------------------------|
| insured_name | policies, claims, ew_vehicle_claims, survey_fee_bills, ew_lot_claims | same meaning, denormalised snapshot onto claim/bill/lot rows |
| policy_number | policies, claims, ew_vehicle_claims, ew_lot_claims | same meaning, snapshot onto claim row |
| insurer_name | claims, ew_vehicle_claims, survey_fee_bills | same meaning; also `policies.insurer` (different column name, same semantic) |
| lob | policy_types, policies, claims, survey_fee_bills, document_templates, generated_documents, claim_fsr_drafts, gipsa_fee_schedule | same meaning everywhere |
| policy_type | policy_types, policies, claims | same meaning |
| ref_number | claims, ew_vehicle_claims, survey_fee_bills, claim_messages, claim_reminders, claim_workflow, claim_documents (in v10), activity_log, global_chat_messages (tagged_ref_numbers array), ew_lot_claims | same meaning; denormalised everywhere for read speed |
| claim_id | claim_stages, claim_documents, claim_messages, claim_assignments, claim_workflow, claim_workflow_history, claim_reminders, survey_fee_bills, generated_documents, claim_emails, claim_ai_conversations, claim_fsr_drafts, ew_vehicle_claims (declared UUID but claims is BIGSERIAL) | same meaning; multi-type mismatch on ew_vehicle_claims + claim_emails |
| company | claims, policies, claim_assignments, activity_log, app_users, document_templates, generated_documents, claim_messages, claim_reminders, survey_fee_bills, bill_counters, ew_vehicle_claims, gipsa_fee_schedule, brokers, claim_workflow, global_chat_messages, user_sessions, fsr_templates, ew_lots, ew_lot_counters | same meaning; company tenancy scoped per-row on most mutable tables |
| status | claims, ew_vehicle_claims, claim_stages (indirectly via stage), claim_workflow, claim_assignments, claim_documents, app_users (is_active instead), insurers, brokers, claim_reminders, ew_lots | different semantic domains per table (claim status vs assignment status vs user is_active) |
| city | insurers, insurer_offices, brokers, policies | same meaning |
| state | insurers, insurer_offices, brokers | same meaning |
| pin | insurers, insurer_offices | same meaning |
| gstin | insurers, insurer_offices | same meaning |
| phone | insurers, insurer_offices, brokers, policies | same meaning |
| email | insurers, insurer_offices, brokers, policies, app_users, activity_log (user_email), claim_messages (sender_email), claim_reminders (sent_by), claim_workflow (assigned_to/assigned_by), gmail_tokens, global_chat_messages (sender_email), user_sessions, global_chat_reads, message_reads, claim_ai_conversations (created_by) | different semantic per column (user vs contact email) but all TEXT |
| contact_person | insurer_offices, brokers | same meaning |
| folder_path | claims, policies, ew_vehicle_claims | same meaning (D:\2026-27\... path) |
| date_of_intimation | claims (renamed in fix_inconsistencies), ew_vehicle_claims, ew_lot_claims | same meaning; earlier column name was `date_intimation` |
| date_loss | claims, ew_lot_claims (as date_of_loss) | same meaning, different column names |
| chassis_number | claims, ew_vehicle_claims, ew_lot_claims | same meaning; denormalised to lot snapshot |
| vehicle_make | ew_vehicle_claims, ew_lot_claims | same meaning |
| vehicle_reg_no | ew_vehicle_claims, ew_lot_claims | same meaning |
| customer_name | ew_vehicle_claims, ew_lot_claims | same meaning; note: `claims.insured_name` vs EW `customer_name` — often the same person in EW context |
| dealer_name | claims (added for Marine EW), ew_vehicle_claims | same meaning |
| dealer_address | ew_vehicle_claims | only in EW |
| insurer_address | claims (via appointing_office_address), ew_vehicle_claims | similar semantic |
| appointing_office_id/name/address | claims, ew_vehicle_claims | same meaning, parallel 3-office model in both |
| policy_office_id/name/address | claims, ew_vehicle_claims | same meaning |
| fsr_office_id/name/address | claims, ew_vehicle_claims | same meaning |
| assigned_to | claims (added v9), claim_assignments, claim_workflow, ew_vehicle_claims | same meaning; two parallel places to "assign" a claim |
| assigned_surveyor / assigned_surveyor_name | claims, ew_vehicle_claims | same meaning |
| sla_due_date | claims, ew_vehicle_claims | same meaning |
| counter_value | ref_counters, marine_counters, bill_counters, ew_lot_counters (as current_count) | same meaning |
| gross_loss | claims (gross_loss), ew_vehicle_claims (estimated_loss_amount / gross_assessed_amount), survey_fee_bills (loss_amount), ew_lot_claims (estimated_loss_amount / gross_assessed_amount) | overlapping concepts with varying names |
| assessed_loss | claims, ew_vehicle_claims (net_adjusted_amount), ew_lot_claims (net_adjusted_amount) | same meaning, different column names |
| mentioned_users | claim_messages, global_chat_messages | same meaning (TEXT JSON array) |
| is_read_by / message_reads | claim_messages.is_read_by (TEXT JSON), message_reads (normalized table), global_chat_reads (normalized) | same meaning implemented two ways — the JSON column is vestigial after v12 added `message_reads` |
| cover_letter_opening / cover_letter_closing / conclusion_text | document_templates.content (embedded), fsr_templates (separate columns), ew_vehicle_claims.conclusion_text | same "template boilerplate" meaning, split across tables |

### 4.2 Duplicate logic

| Logic | Files | Short description |
|-------|-------|--------------------|
| GIPSA fee slab calculation | `app/api/survey-fee-bills/route.js` (`calculateGIPSAFee`), `app/survey-fee-bill/page.js` (`calculatePreview`), `app/api/ew-lots/route.js` (`calculateEwFee`) | Three independent implementations of slab-based survey-fee calculation. The non-EW ones walk `gipsa_fee_schedule`; the EW one hard-codes its own scale. |
| Ref-number format / financial-year suffix `/26-27` | `app/api/tentative-ref/[lob]/route.js` (13-case switch), `app/api/claims/route.js` (same format but inline), `app/api/ew-claims/route.js` (EW-specific), `app/api/survey-fee-bills/route.js` (bill number suffix) | FY suffix and LOB-specific format strings (e.g. `EW-0001/26-27`, `INS-0001/26-27`, `TMT-001/26-27`) are duplicated across four files. |
| Folder-path construction `D:\2026-27\{company}\{lob}\{ref - name}` | `app/ew-vehicle-claims/[id]/page.js` (lines 520, 572), `app/api/claims/route.js`, `app/api/ew-fsr-save/route.js`, `app/api/ew-claim-media/route.js`, `app/mis-portal/page.js`, `app/claims/[lob]/page.js`, `app/policy-master/page.js`, and mirrored in `scripts/puppeteer-server/server.js`, `scripts/folder-listener/listener.js`, `scripts/file-server/server.js` | Path separator `D:\\2026-27\\` + relative-path strip (`replace(/^D:\\\\2026-27\\\\?/, '')`) appears verbatim in 8+ files. |
| File-server proxy fetch boilerplate (headers: X-API-Key + FILE_SERVER_KEY + resolveFileUrl) | `app/api/file-proxy/route.js`, `app/api/ew-claim-media/route.js`, `app/api/ew-fsr-save/route.js`, `app/api/generate-pdf/route.js`, `app/ew-vehicle-claims/[id]/page.js` (resolveFileUrl helper), `app/mis-portal/page.js`, `app/claims/[lob]/page.js`, `app/policy-master/page.js` | Same env-var lookup and fetch wrapper reimplemented per file. |
| FSR HTML placeholder fill (`{{field}}` → value) | `app/api/ew-fsr-generate/route.js`, `app/api/generate-document/route.js`, `app/lor-ila-generator/page.js`, `app/fsr-template-editor/ew-vehicle/page.js`, `app/ew-vehicle-claims/[id]/page.js`, `app/api/ai/generate-fsr/route.js` | Each file has its own regex-replace of `{{xxx}}` placeholders against a claim/EW claim object. |
| Status/stage colour tables | `app/ew-vehicle-claims/[id]/page.js` (`STAGE_STATUS_COLORS`), `lib/pipelineStages.js` (stages with `color`), `lib/constants.js` (`LOB_COLORS`), `lib/ewStages.js` (no colours but parallel stage list), `app/ew-vehicle-claims/mis/page.js`, `app/workflow-overview/page.js`, `app/file-assignments/page.js`, `app/mis-portal/page.js`, migration_claim_categories.sql (`color` column seeded) | Multiple parallel tables of stage-to-colour / LOB-to-colour. `claim_categories.color` is a DB-driven one; the rest are hard-coded JS. |
| `showAlertMsg(msg, type)` pattern with 4-5s auto-dismiss | 24 page files listed under §1 | Identical `const [alert, setAlert] = useState(null); function showAlertMsg(...) { setAlert(...); setTimeout(() => setAlert(null), 4000); }` copy-pasted into every page. |
| LOB/Company filter + debounced search useEffect pattern | `app/mis-portal/page.js`, `app/claims/[lob]/page.js`, `app/ew-vehicle-claims/page.js`, `app/ew-vehicle-claims/mis/page.js`, `app/policy-directory/page.js`, `app/file-assignments/page.js`, `app/workflow-overview/page.js`, `app/survey-fee-bill/page.js`, `app/ref-number-portal/page.js` | Same `useState` filter fields, `useEffect([...filters, company], loadX)` dependency array pattern. |
| Financial year literal `/26-27` | `app/api/tentative-ref/[lob]/route.js`, `app/api/survey-fee-bills/route.js`, `app/api/ref-structure/route.js`, `scripts/puppeteer-server/server.js`, `scripts/folder-listener/listener.js`, `scripts/file-server/server.js` | Literal `/26-27` baked into 6+ places; would require string-replace for FY rollover. |
| Activity-log insert for auth/claim/ew write operations | `app/api/auth/login/route.js`, `app/api/claim-messages/route.js`, `app/api/claim-stages/route.js`, `app/api/ew-claims/route.js`, `app/api/ew-lots/route.js`, `app/api/global-chat/route.js`, plus via `lib/activityLogger.js` called from pages | Same `supabaseAdmin.from('activity_log').insert([{ user_email, ... }])` repeated in APIs that could have centralised through `lib/activityLogger.js`. |
| Role-based admin gating `user?.role === 'Admin' &&` | `components/PageLayout.js` (sidebar), `app/user-management/page.js`, `app/activity-log/page.js`, `app/user-monitoring/page.js`, `app/ew-vehicle-claims/[id]/page.js` (activity tab) | Scattered inline role checks. |

### 4.3 Repeated UI patterns

| Pattern | Files exhibiting it | Extracted component? (yes/no) |
|---------|---------------------|--------------------------------|
| Sidebar + header PageLayout wrapper | `app/**/page.js` (every non-login page) | yes — `components/PageLayout.js` |
| Filter panel + table + status badges | `app/mis-portal/page.js`, `app/ew-vehicle-claims/mis/page.js`, `app/ew-vehicle-claims/page.js`, `app/policy-directory/page.js`, `app/policy-master/page.js`, `app/insurer-master/page.js`, `app/broker-master/page.js`, `app/user-management/page.js`, `app/file-assignments/page.js`, `app/workflow-overview/page.js`, `app/survey-fee-bill/page.js`, `app/activity-log/page.js`, `app/ref-number-portal/page.js` | no — each page reimplements `.filter-section`, `.mis-table-container`, `.mis-table` using shared CSS classes in `app/globals.css`. |
| Modal `showModal` + formData state + Save/Cancel | `app/broker-master/page.js`, `app/insurer-master/page.js`, `app/policy-master/page.js`, `app/user-management/page.js`, `app/claims/[lob]/page.js`, `app/survey-fee-bill/page.js`, `app/file-assignments/page.js`, `app/lor-ila-generator/page.js`, `app/claim-categories/page.js` | no |
| Toast/alert banner `alert && <div className={`alert ${alert.type}`}>` | 24 pages listed above | no |
| LOB grid with coloured boxes | `app/claim-registration/page.js`, `app/page.js` (dashboard LOB distribution) | no |
| `useCompany`/`useAuth` + company badge | `components/PageLayout.js`, every page indirectly | yes — contexts, but not the badge UI |
| "Quick-fill from Policy Master" button (`fetchFromPolicyMaster`) | `app/ew-vehicle-claims/register/page.js`, `app/claims/[lob]/page.js` | no — each page rewrites the match logic |
| Company selector dropdown in header | `components/PageLayout.js` | yes |
| Rich-text placeholder fill/preview | `app/lor-ila-generator/page.js`, `app/fsr-template-editor/ew-vehicle/page.js`, `app/ew-vehicle-claims/[id]/page.js` (FSR generate button) | no |
| Global chat bubble (bottom-right) | every page via `components/PageLayout.js` → `components/GlobalChatBox.js` | yes |
| Bell-icon unread count badge | `components/PageLayout.js` | yes |
| EW stage stepper with coloured rings | `app/ew-vehicle-claims/[id]/page.js`, `app/ew-vehicle-claims/dashboard/page.js`, `app/ew-vehicle-claims/mis/page.js` | no |

---

## 5. Orphan Report

### 5.1 Orphan tables

| Table | Defined in (file) | Last touched migration |
|-------|-------------------|-------------------------|
| doc_types | `supabase/schema.sql` | `supabase/schema.sql` (v1) |
| user_sessions | `supabase/migration_v11_chat_user_monitoring.sql` | v11 |
| surveyors | referenced only in `app/api/surveyors/route.js` — NOT defined in any migration | n/a (writers call a non-existent table) |

Notes:
- `doc_types` is seeded implicitly by no migration and queried by no file anywhere.
- `user_sessions` exists as a table but nothing ever writes or reads it. `app_users.last_active` and `activity_log` are used instead.
- `surveyors` is the inverse — the table is never created but the API happily calls `.from('surveyors')`. Any call will fail at runtime unless the DB has an ad-hoc table created outside migrations.

### 5.2 Orphan columns

| Table | Column | Notes |
|-------|--------|-------|
| claims | md_ref_number | Schema column; not referenced by any JS page/API other than the claims form itself (only read/written through the generic ...formData spread). Possibly a Marine-Cargo-specific attribute never surfaced in UI tables. |
| claims | appointing_insurer | Defined in schema; `appointing_office_name` supersedes it after `fix_inconsistencies`. Grep shows it only in `app/claims/[lob]/page.js` in 1 read path and inside seed data. |
| claims | vessel_name | Only referenced by `app/claims/[lob]/page.js` form input; not in MIS grids. |
| claims | consignor / consignee | Only in Marine form; used for display but not in MIS export. |
| claims | lot_number | Column on claims table (from v1) — distinct from `ew_vehicle_claims.lot_number` (v_ew_claims_lot_number migration). Used only in Marine-related form fields in `/claims/[lob]`, never by EW. |
| policies | description | Added in v2 `ALTER TABLE policies ADD COLUMN IF NOT EXISTS description` — zero references in `app/` or `lib/`. |
| policies | coverage_amount | Added in v2 — zero references. |
| policy_types | (base shape) | Read by APIs; `ALTER` to add `company`/`status` not applied. Column `policy_type` is generic, but no orphan columns flagged. |
| claim_workflow | tat_days, tat_from, is_tat_breached | Written via insert seeds only. `is_tat_breached` is never updated by any JS — always FALSE. |
| claim_workflow_history | old_value, new_value | Schema present; never populated anywhere. |
| ew_vehicle_claims | service_history_verified | Defaults to true; not exposed on any form or MIS grid. |
| ew_vehicle_claims | amount_in_words | Form input exists on detail page, written to DB, but never rendered back in an FSR template JS path (the FSR HTML uses hard-coded text). |
| fsr_templates | signature_text | Has default 'Authorised Signatory'; not referenced by `app/api/ew-fsr-generate/route.js` or editor save JS. |
| fsr_templates | assessment_label_gross / gst / total / not_covered / net | Columns exist; the FSR generator uses hard-coded labels. |
| gipsa_fee_schedule | flat_fee | Column present; JS calculation (`calculateGIPSAFee`) ignores it and uses description-string logic instead. |
| gipsa_fee_schedule | max_fee | Column present; unused in calculation. |
| gipsa_fee_schedule | is_custom | Column present; not filtered anywhere. |
| claim_documents | generated_from_template | Column present (v5); never read or written by JS. |
| claim_categories | metadata (jsonb) | Column defined; no JS reference. |
| claim_categories | code, icon, color | Read by UI pages (claim-registration list uses icon/color), but `code` is only read inside the admin editor. |
| brokers | gst_number | Form writes it; MIS/table views never show it. |
| insurers | status, phone | Form/MIS writes them; not surfaced in read tables. |
| survey_fee_bills | payment_reference, payment_date | Schema present; JS forms expose payment_status but not these two. |
| survey_fee_bills | fee_type='Custom' path uses calculated_fee | `fee_type` is written but not read to branch display anywhere else. |

(Generic `id`, `created_at`, `updated_at`, and audit columns skipped per task instructions.)

### 5.3 Orphan files

| File | Reason it looks orphaned |
|------|---------------------------|
| `app/fsr-template-editor/page.js` | Landing page that just links to `/fsr-template-editor/ew-vehicle`. Not imported; reachable via router. Valid — flagged only as thin. |
| `app/api/surveyors/route.js` | Queries table that doesn't exist in any migration (`surveyors`); no front-end page fetches from it (the only caller is `app/claims/[lob]/page.js` line ~30 which then silently ignores an empty result). Effectively dead at runtime. |
| `migration_v10_claim_documents_gmail.sql` (at repo root, not under `supabase/`) | Stray from the rest of the migration set. Its `CREATE TABLE claim_documents` is shadowed by v5's earlier definition; its new columns (gmail_*, file_*, source) are never ALTERed on top. The `gmail_tokens`/`claim_emails` tables do land though. |
| `app/api/extract-policy/route.js` | Defined POST handler using pdf-parse / mammoth; `app/policy-master/page.js` wires it to the "Extract Policy" button, so not fully orphan, but only reachable via one button. |
| `app/api/generate-document/route.js` GET handler | Handler is defined (line 105) but never called from any page — the UI uses the POST path. |
| `.next/server/app/page.js`, `.next/static/chunks/app/page.js`, `.next/server/app/login/page.js`, `.next/static/chunks/app/login/page.js` | Next.js build artefacts. Not flagged as orphan code — build output. |

### 5.4 Orphan SQL migrations

| File | What it defines | Superseded by |
|------|------------------|----------------|
| `supabase/migration_v6_development_sample_data.sql` | Sample data for Development company; does not define new schema (only INSERTs). | Not superseded; seed-only, but entirely orphan for any fresh deploy that doesn't want the 'Development' sample data. |
| `migration_v10_claim_documents_gmail.sql` (at project root) | `claim_documents` UUID version + gmail_tokens + claim_emails. | v5 already defines `claim_documents` with BIGSERIAL PK; v10's `CREATE IF NOT EXISTS` is a no-op for that table. Only `gmail_tokens` and `claim_emails` from v10 end up in DB — with a broken UUID FK to claims (which is BIGSERIAL). |
| `supabase/migration_ew_stages_12_to_8.sql` | Converts rows from 12-stage to 8-stage EW scheme. | Pure data-migration; the 12-stage numbers are no longer referenced anywhere in JS (`lib/ewStages.js` only enumerates the 8). After one-time run, this file is historical. |
| `supabase/fix_duplicate_doc_categories.sql` | DELETE duplicate `ew_document_categories` rows. | One-shot cleanup. |
| `supabase/migration_claim_categories_text_fields.sql` | Adds `claims.cause_of_loss`, `claims.subject_matter` text columns. | Additive, still referenced. Not orphan. |

None of the migrations DROP a table; what v10 tried to redefine (`claim_documents`) is effectively ignored but the file's other tables land — so v10 is partially orphan, not fully.

---

## 6. Circular Dependency Report

### 6.1 Module-level import cycles

Scanning imports across `app/`, `lib/`, `components/`:
- `components/PageLayout.js` imports `components/GlobalChatBox.js`, `lib/constants.js`, `lib/CompanyContext.js`, `lib/AuthContext.js` — no reverse imports.
- `components/GlobalChatBox.js` imports `lib/AuthContext.js`, `lib/CompanyContext.js` — no reverse imports.
- `lib/AuthContext.js` does not import any other lib file.
- `lib/CompanyContext.js` does not import any other lib file.
- `lib/constants.js` is dependency-free.
- `lib/pipelineStages.js`, `lib/ewStages.js`, `lib/aiClient.js`, `lib/supabase.js`, `lib/supabaseAdmin.js`, `lib/activityLogger.js`, `lib/documentExport.js` are leaf modules (no cross-lib imports).
- All `app/**/page.js` files import from `components/` and `lib/` only; none import each other.
- All `app/api/**/route.js` files import from `lib/` only.

No A→B→A cycles found.

### 6.2 Table-write cycles

Ignoring `activity_log` (hub table — written from 7+ places). Non-trivial bidirectional couplings:

- `claims` ↔ `ew_vehicle_claims`: `app/api/claims/[id]/route.js` writes `ew_vehicle_claims` when a claim's LOB changes; `app/api/claims/route.js` writes `ew_vehicle_claims` and `ew_claim_stages` when creating an EW claim; `app/api/ew-claims/route.js` writes both `ew_vehicle_claims` AND `claims` on POST (creates the parent claim row). `app/api/ew-fsr-save/route.js` reads `claims.folder_path` AND updates `ew_vehicle_claims.fsr_generated_at`. This is a genuine two-way coupling with data flowing both directions.
- `claim_messages` ↔ `global_chat_messages`: `app/api/global-chat/route.js` writes `global_chat_messages` AND conditionally mirrors into `claim_messages` when a message tags a ref_number. `app/api/claim-messages/route.js` writes `claim_messages` only, but both tables share the mention/read model. No reverse flow (claim_messages never back-feeds global_chat_messages).
- `ref_counters` ↔ `marine_counters`: `app/api/claims/route.js` writes both on Marine claim creation; `app/api/claims/[id]/route.js` rolls back both on claim deletion. No cycle — just same file touching both.
- `ew_vehicle_claims` ↔ `ew_lots` ↔ `ew_lot_claims`: `app/api/ew-lots/route.js` writes `ew_lots`, `ew_lot_claims`, and stamps `ew_vehicle_claims.lot_id`/`lot_number`; DB triggers on `ew_lots` write back to `ew_vehicle_claims.lot_number`. Three-way coupling maintained by a mix of app code and DB triggers.
- `claim_documents` ↔ `generated_documents`: `app/api/generate-document/route.js` writes `generated_documents` then inserts a row into `claim_documents` pointing back to it. One-way, not cyclic.
- `app_users` ↔ `activity_log`: `app/api/auth/login/route.js` updates `app_users.last_login` and writes a login row to `activity_log`. Not cyclic — `activity_log` is the hub (see note).

### 6.3 Cross-feature leakage

| Writer file | Tables it writes across features |
|-------------|------------------------------------|
| `app/api/claims/route.js` | Main-claims writer that also inserts into EW-feature tables (`ew_vehicle_claims`, `ew_claim_stages`) when `lob='Extended Warranty'`. |
| `app/api/claims/[id]/route.js` | Main-claims update path that writes EW tables when the LOB is changed into EW. |
| `app/api/ew-claims/route.js` | EW-feature writer that also creates a parent row in the core `claims` table. |
| `app/api/survey-fee-bills/route.js` | Billing feature writer that updates `claims.survey_fee_*` columns directly. |
| `app/api/policies/[id]/upload-copy/route.js` | Policy-master writer; uploads to Supabase `documents` storage bucket which is otherwise used for claim documents in `app/api/documents/[claimId]/route.js`. |
| `app/api/gmail/tag/route.js` | Gmail feature writer that pushes attachments into `claim_documents` (core claim feature). |
| `app/api/global-chat/route.js` | Global-chat writer that conditionally mirrors tagged messages into per-claim `claim_messages`. |
| `app/api/ew-lots/route.js` | Lot feature writer that stamps `ew_vehicle_claims.lot_id/lot_number` (cross-feature into main EW claim row). |
| `app/api/ew-fsr-save/route.js` | FSR feature writer that reads `claims.folder_path` and stamps `ew_vehicle_claims.fsr_generated_at`. |
| `app/api/ai/generate-fsr/route.js` | AI feature writer that reads both `claims` and `ew_vehicle_claims` and writes into `claim_fsr_drafts` + `claim_ai_conversations`. |
| `app/api/claims/[id]/route.js` and `app/api/claim-stages/route.js` | Both update `claims.pipeline_stage` / `claims.pipeline_stage_number` — pipeline-feature columns maintained from two distinct entrypoints. |

---

_How this was generated: I parsed all 28 SQL files chronologically and folded ALTER TABLEs into the base CREATE TABLEs to build the consolidated schema; I then grepped `.from()`/`.insert()`/`.update()`/`.delete()` call sites across `app/**/*.js` to build the usage matrix; form-field sections came from grepping `formData.<field>` / `form.<field>` / `<F field="…"/>` patterns in page files._

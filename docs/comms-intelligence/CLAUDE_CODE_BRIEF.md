# NISLA Communications Intelligence — Claude Code Build Brief

A single consolidated reference to drive the build through Claude Code. Save this file at `docs/comms-intelligence/CLAUDE_CODE_BRIEF.md` inside the portal repo and reference it in every Claude Code session.

**Rules of engagement with Claude Code:**

1. Start every non-trivial session in plan mode (`Shift+Tab`). Review the plan, push back, then approve.
2. Work one phase at a time. Do not start a phase until the previous one is merged and tested.
3. Every session begins with: *"Read `docs/comms-intelligence/CLAUDE_CODE_BRIEF.md` and the three source spec files before answering."*
4. Commit after every phase with a clean working tree so any bad phase can be reset.

---

## Part 1 — Project context

### What we are building

An AI-driven inbox-triage layer added to the existing NISLA Operations Portal. It ingests every incoming email and WhatsApp message, classifies it into one of 8 workflow tags, extracts structured fields, and routes it to the right downstream action — creating claims, attaching photos, drafting replies, notifying surveyors. Multi-tenant from day one: serves both NISLA and Acuere from one codebase, one database, with RLS-based isolation.

### Source spec files (authoritative — do not modify)

All three live at `docs/comms-intelligence/`:

- `comms_schema.sql` — base Postgres/Supabase schema: 8 tables, 2 views, triggers, RLS, seeded tag library
- `comms_intelligence.jsx` — reference React UI prototype for the Inbox Triage screen
- `NISLA_Communications_Intelligence_Blueprint.docx` — implementation blueprint, 6-week plan, cost model, risk register

Additional migrations and extensions live in **new** files alongside these. The three originals are frozen.

### Existing stack (reuse, do not replace)

- Next.js (App Router) on Vercel
- Supabase: Postgres + Auth + Storage + **Vault** (for OAuth/token secrets)
- Claude API (`claude-sonnet-4-20250514` default; Haiku fallback as cost optimization later)
- Gmail API (read + modify scopes only) and WhatsApp Business Platform (Cloud API)

### Organizations

- `nisla` — Nathani Insurance Surveyors and Loss Assessors
- `acuere` — separate entity; identical operational workflow; different branding and FSR template

---

## Part 2 — Design decisions (settled — do not re-debate)

### Multi-tenancy

- Single Supabase project. Isolation via Row-Level Security, not separate databases.
- Every comms table carries an `organization` column (enum: `'nisla' | 'acuere'`).
- Membership: `user_organizations (user_id, organization, role)`.
- Roles: `operator` | `admin` | `auditor`.
- Surveyor pool is **shared** across orgs (one pool, cross-org assignment allowed).
- Claims are **org-scoped** (the existing `claims` table must have or be extended with an `organization` column).
- FSR templates are **org-scoped** — same `generate_fsr` action, handler selects template by the claim's organization.
- Outbound email and WhatsApp templates are org-scoped — same action types, handlers select by org.

### Routing structure

```
/communications                             → redirect to user's first org, or org picker if multiple
/communications/[org]                       → Inbox Triage screen for that org
/communications/[org]/settings/mailboxes    → admin: mailbox CRUD
/communications/[org]/settings/tags         → admin: tag library editor
/communications/[org]/settings/members      → admin: membership + role management
```

### Org switcher

- Component in the header. Lists `user_organizations WHERE user_id = auth.uid()`.
- Hidden when the user has only one membership.
- Pure navigation — not a permission boundary. RLS is the permission boundary.
- Clicking a different org navigates to `/communications/{org}`.

### Operator modes (both supported simultaneously)

- **Cross-org operator** (e.g., Rahul): multiple rows in `user_organizations`. Sees the switcher with all their orgs. Each org has its own page.
- **Per-org operator**: single row in `user_organizations`. No switcher visible. Lands directly on their org's page.

The same schema and RLS policies support both — which type a user is falls out of their membership rows.

### Tag library

- Stored in `tag_definitions` with an `organization` column.
- On migration, the existing 8 seeded NISLA rows are duplicated into 8 Acuere rows.
- `UNIQUE (organization, tag)` replaces the global `UNIQUE (tag)` constraint.
- Per-org rows allow independent tuning: thresholds, classifier prompts, display labels, routing actions can diverge later without touching the other org.

### Mailboxes

- Start with **ONE** Gmail mailbox per org. Additional mailboxes added through the admin UI without a deploy.
- `mailboxes` table: one row per Gmail account or WhatsApp number, with `organization`, `address`, `source`, `display_name`, `oauth_secret_ref` (pointer into Vault), `last_history_id`, `watch_expires_at`, `enabled`, `deleted_at`.
- **Add Gmail flow**: admin enters address → server-side state token → redirect to Google OAuth consent → callback at `/api/oauth/gmail/callback` exchanges code for refresh token → **refresh token into Supabase Vault** → `mailboxes` row inserted with `oauth_secret_ref` → `users.watch` called immediately (when Push is live) → row becomes active.
- **Add WhatsApp flow**: admin enters number + display name + system token + webhook verify token → token stored in Vault → test template message sent to verify.
- **Disable**: `UPDATE mailboxes SET enabled = false`. Reversible.
- **Delete**: single transactional action — `users.stop` on Gmail watch, revoke OAuth grant, delete Vault secret, `SET deleted_at = now()`. Never `DELETE` the row (FK integrity from `inbox_messages`).
- Every CRUD op writes to `mailbox_audit`.

### Ingestion

- **Week 1:** Vercel Cron polling every 5 minutes against the one seeded mailbox per org.
- **Week 5+:** migrate to Gmail Push via Cloud Pub/Sub (near-real-time). Keep a 1-hour poller as fallback.
- WhatsApp is webhook-driven from the moment it's wired (Week 4).

### Classifier

- One Claude call per message.
- Model: `claude-sonnet-4-20250514` default.
- System prompt dynamically loads the full tag library **filtered by the message's org**: `SELECT * FROM tag_definitions WHERE organization = <org> AND enabled = true`.
- JSON output validated against the tag's `extraction_schema`. Missing required fields or malformed values force `is_valid = false` and human review regardless of confidence.
- Auto-route only if `confidence ≥ tag.auto_route_threshold` **AND** `is_valid = true`.
- PII masker (PAN, Aadhaar, phone numbers) wraps every outbound Claude call.

### Security — non-negotiable

1. OAuth refresh tokens and WhatsApp system tokens **never** stored in regular table columns. Always Supabase Vault with a ref pointer.
2. Anthropic API key is server-side only. Never shipped to the browser. The "Test Classifier" modal calls a server action.
3. PII masker wraps every outbound Claude call (classification and extraction). Masked values are what get stored in `extracted_data`.
4. Every destructive action (mailbox delete, member removal, tag edit, role change) writes to an audit table.
5. Service role is the only role with INSERT/UPDATE/DELETE on `inbox_messages`, `message_classifications`, `extraction_results`, `routing_actions`. UI writes through RPC functions, never direct table writes.
6. Claude Code may **not** commit any file containing a real API key, OAuth secret, or system token. Only `.env.example` with placeholder names.

### Out of scope (deliberately deferred)

- Gmail `users.stop` outside the mailbox-delete path (Pub/Sub drops events for unreachable mailboxes; not harmful).
- Pub/Sub dead-letter queue (built-in retry is sufficient for launch).
- Webhook replay protection (covered by monotone cursor + `UNIQUE (source, source_msg_id)`).
- Stale-cursor alerting (revisit in Week 6 if operators report missed messages).

---

## Part 3 — Phased build plan

One phase per week. Each phase produces a testable deliverable.

### Week 1 — Schema + single-mailbox Gmail ingestion

Schema migrations (base + multi-tenant addendum) applied to staging. One Gmail mailbox per org ingested via a Vercel Cron poller. Attachments stored in Supabase Storage with SHA-256 dedup. No classifier, no routing, no UI. Deliverable: emails arrive at the seeded mailboxes and rows appear in `inbox_messages` within 5 minutes, with `organization` and `mailbox_id` correctly stamped.

### Week 2 — Classifier + `intimation` and `settlement_advice` end-to-end

Classifier worker picks up `status = 'received'` rows, loads per-org tag library, calls Claude, writes `message_classifications` + `extraction_results`. Validator enforces per-tag JSON schema. Routing handlers built for `create_claim`, `assign_surveyor`, `update_claim_settlement`, `mark_claim_closed`, `trigger_fee_invoice`. FSR template stubbed but generic (per-org template selection lives in Week 4). Test set of 20 historical emails per org hits ≥85% accuracy. Deliverable: a real intimation email creates a claim row in the correct org's claims table within 30 seconds of arrival.

### Week 3 — Inbox Triage UI at `/communications/[org]`

The JSX prototype ported to a live route inside the portal. Replaces `MOCK_MESSAGES` with `v_inbox_with_classification` queried via the Supabase client. Org switcher in the header. Org-scoped counters. Filter by source/status/tag, full-text search, tag override modal, field-edit flow, approve/reject actions backed by RPC functions. Test Classifier modal calls server-side (API key stays on server). Deliverable: an operator logs in, picks an org, reviews auto-applied tags, and approves or overrides them; approved messages execute their routing actions.

### Week 4 — WhatsApp + remaining 6 tags + org-aware templates

WhatsApp Business verified with Meta (started in Week 0). Webhook at `/api/webhooks/whatsapp` ingests messages into the same `inbox_messages` table with `source = 'whatsapp_business'`. Routing handlers for the remaining 6 tags (`surveyor_photos`, `site_visit_report`, `insurer_query`, `client_followup`, `policy_doc`, `internal_admin`). Outbound `send_email` and `notify_whatsapp` handlers use org-keyed templates (`email_templates`, `whatsapp_templates` tables keyed by `(organization, template_name)`). FSR generation handler reads the claim's org and picks NISLA or Acuere format. Deliverable: WhatsApp messages flow through the same triage queue as emails; all 8 tags work end-to-end for both orgs with correct branding on outbound communication.

### Week 5 — Mailbox admin UI + tuning + shadow mode

Mailbox admin UI at `/communications/[org]/settings/mailboxes` — add/disable/delete flow with OAuth callback and Vault integration. Tag editor at `/communications/[org]/settings/tags`. Member management at `/communications/[org]/settings/members`. System runs in shadow mode against a full week of live traffic — all messages flagged for review. Per-tag accuracy measured, `auto_route_threshold` values tuned. Deliverable: admin can add a second mailbox through the UI without a deploy; per-tag accuracy documented; thresholds tuned; ops team trained.

### Week 6 — Gmail Push migration + soft launch

Gmail poller replaced with Pub/Sub push (webhook at `/api/webhooks/gmail`). 1-hour fallback poller retained. Auto-routing enabled for the 4 most accurate tags (typically `intimation`, `settlement_advice`, `policy_doc`, `internal_admin`). Manual review for the other 4. Daily operations metrics visible. Stale-cursor alerting added. Deliverable: module live in production at `/communications`; auto-routing enabled for 4 tags; ingestion latency under 5 seconds; SOP documented.

---

## Part 4 — Ready-to-paste Claude Code prompts

Run each of these in a **fresh** Claude Code session in the portal repo, in **plan mode**. Review the plan, request changes, approve, then let it execute.

### Session 0 — Initialize project context

```
Run /init to generate CLAUDE.md for this repo if one does not exist.
Then read:
- docs/comms-intelligence/CLAUDE_CODE_BRIEF.md
- docs/comms-intelligence/comms_schema.sql
- docs/comms-intelligence/comms_intelligence.jsx
- docs/comms-intelligence/NISLA_Communications_Intelligence_Blueprint.docx

After reading, produce a one-page audit of this existing portal codebase
covering: Supabase client location and pattern, auth implementation, existing
route conventions (App Router structure), existing migrations folder and
naming convention, component library in use, env var conventions, how
cron/serverless jobs are currently deployed. Flag anywhere the brief's
assumptions conflict with what already exists in this repo. Do not write
any code.
```

### Session 1 — Week 1: schema + single-mailbox Gmail ingestion

```
Read docs/comms-intelligence/CLAUDE_CODE_BRIEF.md and the three spec files.

Implement Phase 1 (Week 1) of the build plan: schema migrations + single-
mailbox Gmail ingestion only. No classifier, no routing, no UI.

Deliverables:
1. Copy docs/comms-intelligence/comms_schema.sql into the migrations folder
   following this repo's naming convention. Do not modify its contents.
2. Create a second migration 20260423_comms_multitenant.sql with:
   - organization enum ('nisla','acuere')
   - mailboxes table with oauth_secret_ref pointing to Supabase Vault
   - user_organizations with role enum ('operator','admin','auditor')
   - organization column added to inbox_messages, ingestion_runs,
     routing_actions, message_classifications, extraction_results,
     tag_definitions
   - UNIQUE(organization, tag) on tag_definitions; duplicate the 8 NISLA
     tag rows into 8 acuere rows via INSERT ... SELECT
   - mailbox_audit table
   - deleted_at column on mailboxes
   - RLS policies: read scoped to user_organizations membership; writes
     to mailboxes, tag_definitions, user_organizations require role='admin'
   - Seed one placeholder mailbox per org (I will replace addresses before
     applying)
3. Gmail poller as a Next.js serverless function:
   - Reads SELECT * FROM mailboxes WHERE source='email_gmail' AND
     enabled=true AND deleted_at IS NULL
   - For each mailbox: loads OAuth refresh token from Supabase Vault using
     oauth_secret_ref, fetches new messages via Gmail API, upserts into
     inbox_messages stamped with mailbox_id and organization, saves
     attachments to Supabase Storage at comms/<message_id>/<filename> with
     SHA-256, writes an ingestion_runs row with the new cursor
4. Vercel Cron entry triggering the poller every 5 minutes
5. /api/oauth/gmail/callback stub that will be used in Week 5 (leave
   scaffolded but not yet wired to the admin UI)
6. Env vars added to .env.example: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
   SUPABASE_SERVICE_ROLE_KEY, SUPABASE_VAULT_URL (or whatever this repo uses)
7. docs/comms-intelligence/RUNBOOK.md covering:
   - One-time Google Cloud OAuth app setup
   - How to obtain the initial refresh token for the seed mailbox
   - How to write that token to Supabase Vault
   - How to verify the poller is working

Acceptance: after applying migrations and seeding the real mailbox address
+ Vault secret, a new email arriving at the seeded mailbox appears in
inbox_messages within 5 minutes, with organization and mailbox_id set
correctly. Re-running the poller does not create duplicates.

Plan mode first. Show me the file list and migration diff before writing.
```

### Session 2 — Week 2: classifier + two tags end-to-end

```
Read docs/comms-intelligence/CLAUDE_CODE_BRIEF.md and the three spec files.
Week 1 is merged.

Implement Phase 2 (Week 2): classifier + 'intimation' and 'settlement_advice'
tags end-to-end. No UI yet.

Build:
1. Classifier worker that picks up inbox_messages with status='received',
   loads tag_definitions filtered by the message's organization, constructs
   a system prompt using the classifyMessage pattern in
   docs/comms-intelligence/comms_intelligence.jsx (but server-side), calls
   Claude Sonnet 4, parses the JSON output, writes rows to
   message_classifications and extraction_results — all stamped with the
   correct organization.
2. PII masker module that strips PAN, Aadhaar, phone numbers before the
   Claude call. Every classifier and extraction call goes through it.
   Masked values are what get stored in extracted_data.
3. JSON-schema validator comparing extracted_data against
   tag_definitions.extraction_schema. Missing required fields -> is_valid
   = false.
4. Routing handlers (new files under src/server/routing/):
   - create_claim — reads the message's organization, INSERTs into the
     existing claims table with organization set
   - assign_surveyor — picks from the shared surveyor pool (no org filter)
   - update_claim_settlement
   - mark_claim_closed
   - trigger_fee_invoice
   Every handler writes a routing_actions row before and after execution.
5. Decision step: auto-route only if confidence >= tag.auto_route_threshold
   AND is_valid=true. Else set status='pending_review'.
6. Test harness: script that runs the pipeline against a fixture of 20
   historical intimation + settlement emails per org and prints per-tag
   accuracy.

Flag anywhere the existing claims table does not yet have an organization
column — if missing, propose the migration to add it before running
create_claim.

Plan mode first.
```

### Session 3 — Week 3: Inbox Triage UI

```
Read docs/comms-intelligence/CLAUDE_CODE_BRIEF.md and the three spec files.
Weeks 1-2 are merged.

Implement Phase 3 (Week 3): Inbox Triage UI at /communications/[org].

Port docs/comms-intelligence/comms_intelligence.jsx into a real Next.js
route. Replace MOCK_MESSAGES with live data from
v_inbox_with_classification (add an organization filter to the view), and
TAGS with a load from tag_definitions filtered by the selected org. Reuse
the portal's existing Supabase client, auth, and layout shell — do not
duplicate the header/nav.

Build:
1. /communications → server component that reads user_organizations for
   the current user. Zero orgs → access denied. One org → redirect to
   /communications/<that_org>. Multiple → org picker screen.
2. /communications/[org] → Inbox Triage screen. Server component fetches
   messages from v_inbox_with_classification WHERE organization = [org].
3. Org switcher component in the header, rendered only when the user has
   >1 membership. Navigates via next/link to /communications/<new_org>.
4. Approve/reject/override actions as server actions backed by Supabase
   RPC functions (not direct table writes). Every write stamped with
   actor_user_id.
5. Test Classifier modal: textarea + Classify button. The Classify button
   calls a server action that runs the same classifier pipeline (with PII
   masker) and returns the result. The Anthropic API key is NEVER exposed
   to the browser.
6. Empty-state handling: if a user navigates to /communications/[org] for
   an org they don't belong to, RLS returns zero rows; UI shows a clear
   "no access" state rather than a blank screen.

Plan mode first.
```

### Session 4 — Week 4: WhatsApp + remaining 6 tags + org-aware templates

```
Read docs/comms-intelligence/CLAUDE_CODE_BRIEF.md and the three spec files.
Weeks 1-3 are merged. WhatsApp Business verification with Meta is complete.

Implement Phase 4 (Week 4):

1. /api/webhooks/whatsapp endpoint validating the Meta signature, ingesting
   messages into inbox_messages with source='whatsapp_business', stamped
   with organization derived from which NISLA/Acuere number received the
   message (mailboxes table lookup by 'address').
2. whatsapp_contacts table populated on first sight of a new number;
   contact_type inferred from context (surveyor if matches a known
   surveyor phone, client if matches an insured's phone, else unknown).
3. Routing handlers for the remaining 6 tags.
4. email_templates and whatsapp_templates tables, keyed by
   (organization, template_name). Seed NISLA and Acuere variants of each
   outbound template (intimation_acknowledgement, status_update,
   new_assignment_notification, etc.).
5. send_email, notify_whatsapp, draft_reply handlers read the relevant
   claim's or mailbox's organization and pick the correct template.
6. generate_fsr handler stub: reads claim.organization, picks nisla_fsr
   or acuere_fsr template. (Full FSR rendering can be deferred; what
   matters here is the org-aware dispatch.)
7. Outbound WhatsApp send capability through the Business API.

Plan mode first.
```

### Session 5 — Week 5: Mailbox admin UI + tuning

```
Read docs/comms-intelligence/CLAUDE_CODE_BRIEF.md and the three spec files.
Weeks 1-4 are merged.

Implement Phase 5 (Week 5):

1. Mailbox admin UI at /communications/[org]/settings/mailboxes.
   - List: address, display name, source, enabled/disabled, last ingestion
     time, messages today, watch_expires_at (if Gmail), "Refresh watch"
     button, disable toggle, delete button.
   - Add Gmail: form -> server action -> state token -> redirect to Google
     OAuth consent -> /api/oauth/gmail/callback exchanges code -> refresh
     token into Supabase Vault -> mailboxes row inserted with
     oauth_secret_ref -> (if Push is live) users.watch called. Fail loudly
     at any step; do not leave partial state.
   - Add WhatsApp: form capturing number, display name, system token,
     webhook verify token. Token into Vault. Test template message sent.
   - Disable: UPDATE mailboxes SET enabled=false. Reversible.
   - Delete: transactional action — users.stop on watch, revoke OAuth
     grant at Google, delete Vault secret, SET deleted_at=now(). Never
     actually DELETE the row. All four steps must succeed or the whole
     action rolls back. Confirmation modal required.
   - Every CRUD op writes to mailbox_audit.
2. Tag editor at /communications/[org]/settings/tags — edit display_label,
   classifier_prompt, extraction_schema, routing_actions,
   auto_route_threshold, enabled. Scoped to the current org only.
3. Member admin at /communications/[org]/settings/members — add/remove
   users from the org, assign role. Writes to membership_audit table.
4. All three admin pages require role='admin' — non-admins navigating to
   them see access-denied.
5. Shadow-mode flag: env var or feature flag that forces every message to
   status='pending_review' regardless of confidence. Used during Week 5
   to measure accuracy without auto-routing.
6. Per-tag accuracy report (a SQL view or a small admin page) computing
   agreement rate between classifier output and operator overrides.

Plan mode first.
```

### Session 6 — Week 6: Gmail Push + soft launch

```
Read docs/comms-intelligence/CLAUDE_CODE_BRIEF.md and the three spec files.
Weeks 1-5 are merged.

Implement Phase 6 (Week 6): Gmail Push migration + soft launch hardening.

1. Replace primary Gmail ingestion with Cloud Pub/Sub push:
   - /api/webhooks/gmail endpoint that verifies the Pub/Sub JWT in the
     Authorization header, parses the historyId, looks up the mailbox
     by emailAddress, calls users.history.list since the mailbox's
     last_history_id, fetches each new message, and upserts into
     inbox_messages using the same handler as the poller.
   - Keep the 5-minute poller running but reduce it to once per hour as
     a fallback.
   - Daily cron to re-call users.watch per enabled Gmail mailbox (watches
     expire after 7 days).
2. Stale-cursor alerting: a cron that queries mailboxes where
   last_ingestion_run was > 30 minutes ago during business hours and
   posts an alert (Slack/email — use whatever the portal already has
   wired up for alerting).
3. Auto-routing enablement — feature flag per org per tag, default off.
   Flip on for intimation, settlement_advice, policy_doc, internal_admin
   once accuracy is confirmed.
4. Ops metrics dashboard at /communications/[org]/settings/metrics:
   daily volume, auto-route ratio, per-tag accuracy, time-to-process
   percentiles. Admin-only.
5. SOP document at docs/comms-intelligence/SOP.md covering the daily
   operator workflow, weekly admin cadence, and the incident-response
   runbook for the known failure modes in the risk register.

Plan mode first.
```

---

## Part 5 — Operational preflight (Rahul's side, before Session 1)

These must be done before Week 1 starts. Claude Code cannot do them.

### Google Cloud

1. Create (or reuse) a GCP project tied to the NISLA Workspace account.
2. Enable the **Gmail API** and, for Week 6 later, **Cloud Pub/Sub API**.
3. Create an OAuth 2.0 client (type: Web application). Add callback URLs for dev, staging, and production.
4. Note the client ID and secret.
5. Configure the OAuth consent screen (internal if the mailboxes are all on a Workspace domain; external + verified otherwise).

### Supabase

1. Confirm service-role access on the existing Supabase project.
2. Enable **Supabase Vault** in the dashboard and create a namespace for comms secrets.
3. Confirm you have a **staging** Supabase project. Do not run untested migrations against production.

### Anthropic

1. Create a workspace-scoped API key.
2. Set a monthly spend cap while developing (e.g., ₹20,000). Reduce loop-in-prod risk.

### Meta / WhatsApp (start now — 1–3 day latency)

1. Begin **Meta Business Verification**. Submit GST + incorporation documents. This blocks Week 4 if delayed.
2. Decide WhatsApp number strategy per org (new dedicated number vs. migrate existing).

### Mailbox addresses to seed

Fill these in before running the Week 1 migration. One per org to start:

- NISLA: `claim.intimation@nisla.in` (or confirm actual address)
- Acuere: `<acuere_primary_address>`

---

## Part 6 — What a "good" Claude Code plan looks like

When Claude Code responds in plan mode, reject the plan and ask for a rewrite if any of the following are missing:

- A file list with paths (new files and files to modify).
- A migration diff if the schema is touched, including rollback SQL.
- Explicit handling of the multi-tenant guardrails: every new table has `organization`; every new query filters by `organization`; every new RLS policy checks `user_organizations`.
- Confirmation that secrets go into Supabase Vault, not into columns.
- Acceptance criteria — how will you (Rahul) verify the phase is done?
- A list of anything deferred to a later phase, with reasoning.

A plan that skips these is a plan that will produce surprise rework later.

---

## Part 7 — Hard stops

If Claude Code proposes any of the following, stop it and ask for a rewrite:

- Storing OAuth refresh tokens or WhatsApp system tokens in any column of any table (regardless of "encryption").
- Calling the Anthropic API from the browser (client component).
- Skipping the PII masker on any classifier/extraction call.
- Allowing direct INSERT/UPDATE to `inbox_messages`, `message_classifications`, `extraction_results`, or `routing_actions` from the UI without going through an RPC function.
- Actually `DELETE`ing a row from `mailboxes` (use `deleted_at` — FK integrity from `inbox_messages` must hold).
- Hardcoding tag definitions in app code (they live in `tag_definitions`; adding a tag should be a config change).
- Any migration that modifies `comms_schema.sql` in place (additive migrations only).
- Any change that couples `nisla` and `acuere` logic without going through the `organization` column and RLS.

---

**This brief is the contract.** Any Claude Code session that strays from it is out of spec. Reference it at the start of every session; hold the plan against it before approving.

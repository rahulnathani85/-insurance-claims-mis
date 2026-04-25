# Communications Intelligence — Stage 1 (Delta F) Deployment

This runbook deploys the Week 2.5 hardening pass: kill switch, activity-log
wiring, extractor registry, PII masker, and admin health page.

> **Scope.** Code-side changes are already merged. What follows is the deploy
> sequence: apply one migration, push to Vercel, and run six smoke tests.
> No new env vars. No external service setup.

---

## 0. Pre-deploy sanity check (optional but recommended)

Local build to catch any module-resolution or syntax surprise before they
become a Vercel deploy failure:

```bash
npm install      # only if dependencies have moved since last local build
npm run build
```

Expected: `Compiled successfully`. The new files use the same `@/*` path
alias the rest of the repo uses, so resolution should not be a problem.

---

## 1. Supabase

### 1.1 Apply migration 8

In **Supabase SQL Editor** (or `psql`/CLI):

```
supabase/migration_comms_8_config_and_audit.sql
```

The migration is wrapped in `BEGIN; ... COMMIT;` and uses `IF NOT EXISTS` /
`ON CONFLICT DO NOTHING`, so re-running is safe.

### 1.2 Smoke check after apply

```sql
-- Singleton row should exist with all flags FALSE.
SELECT id, ingestion_paused, classification_paused, execution_paused
  FROM comms_config;

-- Audit table should exist and be empty.
SELECT COUNT(*) FROM mailbox_audit;
```

Expected:
- `comms_config`: one row (`id=1`, all `paused` flags `false`).
- `mailbox_audit`: 0 rows.

---

## 2. Vercel

### 2.1 Environment variables

**No new env vars for Stage 1.** Confirm the following are still set on the
Vercel project (they were required by Weeks 1-2 and remain unchanged):

- `CRON_SECRET` (or `COMMS_CRON_SECRET`)
- `COMMS_GMAIL_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI`
- `GMAIL_CLIENT_ID` / `_SECRET`
- `COMMS_USER_REDIRECT_URI`
- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`

(Stage 2 will retire the `COMMS_GMAIL_CLIENT_ID` family. Don't pre-emptively
delete those — Stage 2 ships the code that lets us drop them.)

### 2.2 Deploy

Standard flow:

```bash
git add supabase/migration_comms_8_config_and_audit.sql \
        lib/comms/killSwitch.js \
        lib/comms/extractors/index.js \
        lib/comms/piiMasker.js \
        lib/comms/auditLog.js \
        app/api/communications/admin/health/route.js \
        app/communications/admin/health/page.js \
        app/api/comms-cron/gmail/route.js \
        app/api/comms-cron/classify-pending/route.js \
        lib/comms/classifier.js \
        app/api/communications/mailboxes/callback/route.js \
        app/api/communications/opt-in/callback/route.js \
        app/api/communications/opt-in/route.js \
        docs/communications/STAGE_1_DEPLOY.md

git commit -m "comms: stage 1 — kill switch + activity-log wiring + PII masker + extractor registry"
git push origin main   # Vercel auto-deploys on push to main
```

Wait for the Vercel deployment to go green before running smoke tests.

---

## 3. Smoke tests (run in production)

### 3.1 Admin health page renders

Sign in as an Admin user, navigate to:

```
https://<your-domain>/communications/admin/health
```

Expected:
- Three toggle cards (Ingestion / Classification / Execution).
- All three show **RUNNING** badges.
- "Recent ingestion runs" / "Recent classification runs" tables populated
  with prior history (Week 1 + 2 runs are still there).
- "Mailbox / kill-switch audit" table is empty.

### 3.2 Kill switch pauses the gmail cron

On the health page, click **Pause** on the Ingestion card. Expected:
- Card flips to **PAUSED** with a "Paused since …" timestamp.
- A new row in `mailbox_audit` with `event='ingestion_paused'`.

Then trigger the gmail cron manually:

```bash
curl -X POST https://<your-domain>/api/comms-cron/gmail \
     -H "Authorization: Bearer $CRON_SECRET"
```

Expected response:

```json
{
  "ok": true,
  "skipped": "paused",
  "pausedSince": "...",
  "startedAt": "...",
  "finishedAt": "..."
}
```

And in SQL:

```sql
SELECT action, details FROM activity_log
 WHERE action = 'comms_cron_gmail_ingest'
 ORDER BY created_at DESC LIMIT 3;
```

Expected: at least one row with `details` containing `"result": "paused"`.

### 3.3 Resume restores normal flow

On the health page, click **Resume** on Ingestion. Trigger the cron again:

```bash
curl -X POST https://<your-domain>/api/comms-cron/gmail \
     -H "Authorization: Bearer $CRON_SECRET"
```

Expected: response shape returns to `{ ok: true, mailboxes: [...] }`. New
`activity_log` row with `details.result = "ok"`.

### 3.4 Classification kill switch

Repeat 3.2 / 3.3 for the Classification toggle, calling
`/api/comms-cron/classify-pending` instead.

### 3.5 PII masker

Send a test email to a connected Comms mailbox containing realistic-looking
PII, e.g.:

```
PAN: ABCDE1234F
Aadhaar: 1234 5678 9012
Mob: +91 9876543210
```

Wait for the next ingest + classify cycle (or trigger both crons manually).
In Vercel logs (Functions → `/api/comms-cron/classify-pending` → recent
invocation), search for the prompt body that was sent to the model. The PII
should appear redacted: `A********F`, `1************2`, `+***********0`.

### 3.6 OAuth audit

Disconnect the NISLA shared mailbox and reconnect it (or have a test user
opt in their Gmail and immediately revoke).

Expected `mailbox_audit` rows:

```sql
SELECT created_at, event, mailbox_email, company, actor_email
  FROM mailbox_audit
 ORDER BY created_at DESC LIMIT 10;
```

Should include `shared_mailbox_connected`, `per_user_opted_in`, and
`per_user_opt_in_revoked` events as appropriate.

---

## 4. Rollback

If anything misbehaves:

1. **Kill switch all three flags.** Visit `/communications/admin/health`
   and click Pause on Ingestion + Classification + Execution. The system
   does no further work.
2. **Code rollback.** Revert the Stage 1 deploy by reverting the merge
   commit and re-pushing. Migration 8 stays in place — it adds tables that
   nothing else depends on, so no rollback migration is required.
3. **Migration rollback (only if needed).** Migration 8 only adds new
   tables and seeds a singleton row; it touches no existing data. If you
   really need to remove it:
   ```sql
   DROP TABLE IF EXISTS mailbox_audit;
   DROP TABLE IF EXISTS comms_config;
   ```

---

## 5. What Stage 2 changes (preview)

Stage 2 collapses the two Gmail OAuth clients into one. After Stage 2
ships and verifies, ops will:

- Delete `COMMS_GMAIL_CLIENT_ID`, `COMMS_GMAIL_CLIENT_SECRET`,
  `COMMS_GMAIL_REDIRECT_URI` from Vercel env vars.
- Add a second redirect URI to the existing Google OAuth client (the one
  that already powers `/email-check`).
- Optionally delete the standalone "NISLA Comms Shared Mailboxes" OAuth
  client from Google Cloud (kept dormant for 30 days as a fallback).

That's a separate runbook — `STAGE_2_DEPLOY.md` — written when Stage 2 is
greenlit.

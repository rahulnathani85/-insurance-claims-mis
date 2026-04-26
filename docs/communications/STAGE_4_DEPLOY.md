# Communications Intelligence — Stage 4 Deployment

Real-time Gmail ingestion via **Cloud Pub/Sub Push**. Drops latency
from 5 min → seconds.

This is **optional polish** — Stage 3 is already functional. Stage 4
is worth doing once the comms module is in real production use and
ops complain about the 5-minute lag.

---

## What Stage 4 delivers

**New code:**
- `lib/comms/pubsubVerify.js` — verifies the OIDC JWT Google attaches
  to each Push delivery. Pulls Google's JWKS, validates `iss` / `aud` /
  `exp` / signature with RS256. No external dependency.
- `lib/comms/gmailClient.js` — adds `startGmailWatch()`,
  `stopGmailWatch()`, `listGmailHistory()` helpers wrapping
  `users.watch`, `users.stop`, `users.history.list`.
- `lib/comms/ingestGmail.js` — extracts `ingestOneGmailMessage()`
  helper (shared by polling cron + webhook). New
  `processGmailWebhookEvent()` diffs history since
  `last_history_id` and ingests new message IDs.
- `app/api/comms-webhooks/gmail/route.js` — Push receiver. JWT
  verification + kill-switch gate + history diff + ingest.
- `app/api/comms-cron/refresh-watch/route.js` — daily cron that
  renews `users.watch` for every Comms mailbox so the 7-day expiry
  never bites. Also serves as initial provisioning on first tick.

**Schema (migration 10):**
- `gmail_tokens.last_history_id` (BIGINT) — baseline for the next
  `history.list` diff
- `gmail_tokens.watch_expires_at` (TIMESTAMPTZ) — for monitoring +
  prioritised renewal

**Touched:**
- `vercel.json` — adds `refresh-watch` daily cron at `0 3 * * *`
  (3 AM UTC = 8:30 AM IST). Polling cron stays at `*/5` as safety
  net; demote to hourly later once Push is verified stable.

**No new dependencies** — JWT verification uses Node's built-in
`crypto`.

---

## 1. Apply migration in Supabase

```
supabase/migration_comms_10_pubsub_columns.sql
```

Smoke check:
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'gmail_tokens'
   AND column_name IN ('last_history_id', 'watch_expires_at');
-- expect 2 rows
```

---

## 2. Google Cloud Pub/Sub setup

This is the most involved piece — once-only setup. Allow ~15 minutes.

### 2.1 Enable Pub/Sub API

In your Google Cloud project (`nisla.in` org → the project that hosts
your OAuth client):

1. APIs & Services → **Library**
2. Search **"Cloud Pub/Sub API"** → click → **Enable**

### 2.2 Create a topic

1. Open Pub/Sub: https://console.cloud.google.com/cloudpubsub/topic/list
2. Click **Create Topic**
3. Topic ID: `gmail-comms`
4. Leave **Add a default subscription** UNCHECKED (we'll create our
   own with OIDC auth)
5. Click **Create**

The topic's full resource name will be:
```
projects/<your-project-id>/topics/gmail-comms
```
You'll need this for env var `GMAIL_PUBSUB_TOPIC`.

### 2.3 Grant Gmail's service account permission to publish to the topic

This lets Gmail's internal Push system actually post to your topic
when watched mailboxes change.

1. From the topic detail page (Pub/Sub → Topics → `gmail-comms`),
   open the **Permissions** tab on the right side
2. Click **Add Principal**
3. New principals:
   ```
   gmail-api-push@system.gserviceaccount.com
   ```
4. Role: **Pub/Sub Publisher** (`roles/pubsub.publisher`)
5. **Save**

### 2.4 Create a Push subscription with OIDC auth

1. From the topic page, click **Create Subscription** (or open
   Pub/Sub → Subscriptions → Create)
2. **Subscription ID:** `gmail-comms-push`
3. **Cloud Pub/Sub topic:** select `gmail-comms`
4. **Delivery type:** **Push**
5. **Endpoint URL:** `https://portal.nisla.in/api/comms-webhooks/gmail`
6. ☑️ **Enable authentication**
   - **Service account:** select any service account in the project,
     OR click **Create new service account** named
     `gmail-pubsub-pusher` and grant it role
     **Service Account Token Creator** (or just **Pub/Sub Subscriber**
     — for Push delivery only the SA's identity is used to mint
     OIDC tokens; no special permission needed).
   - **Audience:** **`https://portal.nisla.in/api/comms-webhooks/gmail`**
     ← copy-paste this exactly into the env var below.
7. **Acknowledgement deadline:** 60 seconds (default)
8. **Retry policy:** Exponential backoff (default) — minimum 10s,
   maximum 600s
9. **Message retention duration:** 7 days (default)
10. **Create**

If the create button is greyed out with "service account does not
have necessary permissions":
- The service account needs the
  **Service Account Token Creator** role on itself, OR
- The user creating the subscription needs the
  **Service Account User** role on the service account.

### 2.5 Note the values for env vars

You'll need:
- `GMAIL_PUBSUB_TOPIC` = the full topic resource name from §2.2
  (e.g. `projects/nisla-portal-prod-12345/topics/gmail-comms`)
- `GMAIL_PUBSUB_VERIFIER_AUDIENCE` = the audience you set in §2.4
  (e.g. `https://portal.nisla.in/api/comms-webhooks/gmail`)
- `GCP_PROJECT_ID` = your project ID (e.g. `nisla-portal-prod-12345`)
  (informational; not currently read by code, useful for logs)

---

## 3. Vercel env vars

In **Production**:

| Name | Value |
|---|---|
| `GMAIL_PUBSUB_TOPIC` | `projects/<your-project-id>/topics/gmail-comms` |
| `GMAIL_PUBSUB_VERIFIER_AUDIENCE` | `https://portal.nisla.in/api/comms-webhooks/gmail` |
| `GCP_PROJECT_ID` | (your GCP project ID — informational) |

After saving, Vercel auto-redeploys (~30s).

---

## 4. Provision initial users.watch on existing mailboxes

Trigger the new refresh-watch cron once to kick off Push for the
NISLA mailbox you connected in Stage 2:

```bash
curl -X POST https://portal.nisla.in/api/comms-cron/refresh-watch \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expected response:
```json
{
  "ok": true,
  "total": 1,
  "renewed": 1,
  "failed": 0,
  "results": [
    {
      "user_email": "comms-shared:NISLA:claim.intimation@nisla.in",
      "gmail_address": "claim.intimation@nisla.in",
      "ok": true,
      "expiration": "2026-05-03T...",
      "historyId": "...",
      "baselined": true
    }
  ]
}
```

Verify in SQL:
```sql
SELECT gmail_address, last_history_id, watch_expires_at
  FROM gmail_tokens
 WHERE is_comms_mailbox = true OR is_comms_opted_in = true;
```

`watch_expires_at` should be ~7 days in the future.

---

## 5. Verification — send a test email

1. Send a test email to `claim.intimation@nisla.in` from an
   external address
2. Within **2-3 seconds** (vs ~5 min on the polling path), check
   the database:

```sql
SELECT created_at, source_msg_id, subject, status
  FROM inbox_messages
 ORDER BY received_at DESC
 LIMIT 3;
```

A new row should appear within seconds of sending.

3. Check the webhook activity log:
```sql
SELECT created_at, action, details
  FROM activity_log
 WHERE action LIKE 'comms_cron_gmail_webhook%'
 ORDER BY created_at DESC LIMIT 5;
```

Each row's `details` should show `inserted=1`, `failed=0`.

4. Check Vercel function logs (Functions → `/api/comms-webhooks/gmail`)
   for the JWT-verified, processing-completed log lines.

---

## 6. Demote the polling cron (optional, after 7 days of clean Push)

Once Push has been delivering reliably for a week, edit `vercel.json`:

```diff
   {
     "path": "/api/comms-cron/gmail",
-    "schedule": "*/5 * * * *"
+    "schedule": "0 * * * *"
   },
```

Hourly polling becomes the safety net for anything Push missed —
no longer the primary path. Push handles real-time, the cron catches
edge cases (Pub/Sub outage, watch expiry not renewed, etc.).

---

## 7. Rollback

If Push misbehaves:

1. **Disable the Push subscription** in GCP (Pub/Sub → Subscriptions →
   `gmail-comms-push` → **Pause**). Pub/Sub buffers messages while
   paused; resume to drain. Or **Delete** if rolling back permanently.
2. **Pause Ingestion** on `/communications/admin/health` to also gate
   the polling cron during investigation.
3. Code rollback: revert the Stage 4 commit and re-push. Migration
   10 stays in place — additive columns, no foreign keys, harmless.

---

## 8. Common errors

| Error | Cause | Fix |
|---|---|---|
| `JWT signature invalid` | Cached Google certs are stale | Wait 1h for the in-process cache to refresh, or restart the Vercel function |
| `JWT aud '...' does not match expected` | Audience env var doesn't match what was set on the Pub/Sub subscription | Make `GMAIL_PUBSUB_VERIFIER_AUDIENCE` exactly equal the subscription's "Audience" field |
| `403 Forbidden` from `users.watch` | Gmail service account doesn't have publish permission on the topic | Re-do §2.3 — confirm `gmail-api-push@system.gserviceaccount.com` is a Publisher on the topic |
| `Watch expiration time in the past` from Gmail | OAuth scope is wrong | Need `gmail.modify` (we have it). If a fresh user hasn't re-consented since adding scopes, re-OAuth |
| Webhook returns 500 with `last_history_id is too old` | Mailbox went >7 days without Push being processed | Trigger refresh-watch to re-baseline; old history is fetched via fallback search |

---

## 9. What Stage 5 adds (preview)

- `lib/comms/executor.js` — auto-routing engine. For every
  `pending_review` message where extraction `is_valid` and
  classifier confidence ≥ tag's `auto_route_threshold`, executes
  the routing actions defined on `tag_definitions.routing_actions`
  (attach to claim, notify surveyor, etc.).
- `app/communications/review/page.js` — review queue for messages
  below threshold or with validation errors.
- `app/api/comms-cron/execute-routing/route.js` — sweeper cron for
  the executor.
- `lib/comms/metrics.js` + `app/communications/metrics/page.js` —
  per-tag precision dashboard.

After Stage 5, the blueprint's "≥70% auto-route by Week 6" target
is reachable.

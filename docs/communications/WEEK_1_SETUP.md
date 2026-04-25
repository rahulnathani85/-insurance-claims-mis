# Communications Intelligence — Week 1 External Setup

This document lists every external / one-time setup step required to make the
Week 1 Gmail ingestion flow work in production. The code-side work is already
merged; what follows is the out-of-repo wiring.

> **Scope of Week 1.** Shared-mailbox connect flow, per-user opt-in flow, and
> a 5-minute Vercel Cron that polls every connected Gmail, dedupes via
> Gmail message ID, and uploads attachments to Supabase Storage. Classification
> (tagging via Claude) lands in Week 2.

---

## 1. Supabase

### 1.1 Run the migrations in order

From the `supabase/` directory, apply (via Supabase SQL Editor, `psql`, or CLI):

```
migration_comms_1_enums.sql
migration_comms_2_tables.sql
migration_comms_3_tag_seeds.sql
migration_comms_4_views.sql
migration_comms_5_gmail_tokens_additive.sql
migration_comms_6_oauth_state_and_patterns.sql
```

All migrations are idempotent (wrapped in `DO $$ ... END $$` for ENUMs, use
`IF NOT EXISTS` on tables/indexes, `ON CONFLICT DO NOTHING` on seeds), so
re-running is safe.

**Smoke check** after apply:

```sql
SELECT unnest(enum_range(NULL::workflow_tag));   -- expect 9 values
SELECT COUNT(*) FROM tag_definitions;            -- expect 8
SELECT COUNT(*) FROM comms_ref_patterns WHERE is_active; -- expect 5+
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'gmail_tokens'
    AND column_name IN ('is_comms_mailbox','is_comms_opted_in','company');
-- expect 3 rows
```

### 1.2 Create the private Storage bucket

In the Supabase dashboard → **Storage** → **Create new bucket**:

- **Name**: `comms-attachments`
- **Public**: **OFF** (private)
- **File size limit**: 25 MB recommended
- **Allowed MIME types**: leave blank (we store anything Gmail hands us)

Only the service-role key reads/writes this bucket. No policy is required when
RLS is disabled and the client is `supabaseAdmin`; the bucket stays accessible
exclusively through server routes.

---

## 2. Google Cloud — two OAuth clients

### 2.1 Add a redirect URI to the EXISTING per-user Gmail OAuth client

This is the client that already powers `/email-check`. Do **not** create a new
one here — reusing it is what lets an already-connected user opt in without
a second consent screen.

1. Google Cloud Console → **APIs & Services** → **Credentials**.
2. Open the existing OAuth 2.0 Client used by `GMAIL_CLIENT_ID`.
3. Under **Authorized redirect URIs**, add:
   - `https://<your-domain>/api/communications/opt-in/callback`
   - (Also add `http://localhost:3000/api/communications/opt-in/callback` for local dev.)
4. Save. No other change — scopes are requested per-auth-call.

### 2.2 Create a NEW OAuth client for the SHARED mailbox flow

A separate client keeps the shared-mailbox grant isolated from every
individual user's grant, so revoking one never affects the other.

1. Google Cloud Console → **Credentials** → **Create Credentials** → **OAuth client ID**.
2. Application type: **Web application**.
3. Name: `NISLA Comms Shared Mailboxes` (or similar).
4. **Authorized redirect URIs**:
   - `https://<your-domain>/api/communications/mailboxes/callback`
   - `http://localhost:3000/api/communications/mailboxes/callback` (local dev)
5. Save. Capture the `Client ID` and `Client Secret`.
6. On the OAuth consent screen, ensure the project is either in **Production**
   or has the two shared-mailbox Google accounts (`claim.intimation@nisla.in`
   and `claims@acuere.in`) added as test users — otherwise Google blocks the grant.
7. Enable the **Gmail API** for the project if it is not already enabled.

The scopes requested at runtime are:

- `https://www.googleapis.com/auth/gmail.modify` (read + apply labels)
- `https://www.googleapis.com/auth/userinfo.email` (to learn which Gmail was granted)

---

## 3. Gmail mailbox provisioning (IT)

IT provisions and hands back credentials (or simply logs in once during the
OAuth grant) for each per-company shared inbox:

| Company | Shared Gmail                |
|---------|-----------------------------|
| NISLA   | `claim.intimation@nisla.in` |
| Acuere  | `claims@acuere.in`          |

These inboxes become the SPOC for surveyors, third parties, and insurers.
Forward rules from legacy ops inboxes can be pointed here so existing
contacts don't need to update their address books.

---

## 4. Vercel

### 4.1 Plan

Confirmed: **Vercel Pro**. Hobby tier's one-cron-per-day limit cannot support
5-minute polling.

### 4.2 Environment variables

Set these in **Project Settings → Environment Variables** (Production + Preview):

| Name                         | Where used                                 | Notes                                                                    |
|------------------------------|--------------------------------------------|--------------------------------------------------------------------------|
| `COMMS_GMAIL_CLIENT_ID`      | shared-mailbox OAuth                       | From step 2.2                                                            |
| `COMMS_GMAIL_CLIENT_SECRET`  | shared-mailbox OAuth                       | From step 2.2                                                            |
| `COMMS_GMAIL_REDIRECT_URI`   | shared-mailbox OAuth                       | Exact value of the Authorized redirect URI (production domain)           |
| `COMMS_USER_REDIRECT_URI`    | per-user opt-in OAuth                      | e.g. `https://<domain>/api/communications/opt-in/callback`               |
| `CRON_SECRET`                | `/api/comms-cron/gmail` auth               | Any long random string. Vercel Cron auto-injects this as a Bearer token. |
| `GMAIL_CLIENT_ID`            | existing per-user Gmail (reused by opt-in) | Already set                                                              |
| `GMAIL_CLIENT_SECRET`        | existing per-user Gmail (reused by opt-in) | Already set                                                              |

> `COMMS_CRON_SECRET` is also accepted as an alias for `CRON_SECRET` if you
> want a per-module secret. The cron handler checks `COMMS_CRON_SECRET`
> first, then falls back to `CRON_SECRET`.

Production domain examples should be substituted with the actual Vercel project
domain (e.g. `insurance-claims-mis-1kl7.vercel.app` or the custom domain).

### 4.3 Cron

`vercel.json` already declares the schedule. After deploying, confirm it
appears under **Project → Cron Jobs** in the Vercel dashboard. Expected:

```
/api/comms-cron/gmail    */5 * * * *    Active
```

---

## 5. First-run checklist

Once the above is live:

1. **Admin connects the NISLA shared mailbox.**
   - Navigate to `/communications` → "Shared mailboxes".
   - Click **Connect NISLA mailbox**. Google shows a consent screen with the
     `gmail.modify` scope. Sign in as `claim.intimation@nisla.in`.
   - On success you land back on `/communications/mailboxes` with a green
     "Connected NISLA mailbox …" banner.
   - Verify in SQL:
     ```sql
     SELECT user_email, gmail_address, company, is_comms_mailbox
       FROM gmail_tokens
      WHERE is_comms_mailbox = true;
     -- expect 1 row: user_email starts with 'comms-shared:NISLA:', company = 'NISLA'
     ```

2. **One user opts in their own Gmail for NISLA.**
   - Sign in as any non-admin user. Navigate to `/communications` → "Scan my Gmail".
   - Choose **NISLA** and click **Opt in with Google**.
   - Verify in SQL:
     ```sql
     SELECT user_email, gmail_address, company, is_comms_opted_in
       FROM gmail_tokens
      WHERE is_comms_opted_in = true;
     ```

3. **Send three test emails:**
   - **A.** From any external address → `claim.intimation@nisla.in`, subject
     `"Survey photos — C-2025-0042"`, attach any PDF.
   - **B.** From any external address → the opted-in user's work Gmail, subject
     `"Re: C-2025-0042 docs"` (matches the `\mC-\d{4}-\d{3,}` regex), attach any file.
   - **C.** From any external address → the opted-in user's work Gmail, subject
     `"Lunch Friday?"`, no claim reference.

4. **Trigger the cron manually (optional; otherwise wait ≤5 min).**

   ```bash
   curl -X POST https://<your-domain>/api/comms-cron/gmail \
        -H "Authorization: Bearer $CRON_SECRET"
   ```

   Response:

   ```json
   {
     "ok": true,
     "mailboxes": [
       { "user_email": "comms-shared:NISLA:claim.intimation@nisla.in",
         "mode": "shared", "fetched": 1, "inserted": 1, "failed": 0, ... },
       { "user_email": "<opted-in-user>@<domain>",
         "mode": "user",   "fetched": 2, "inserted": 1, "failed": 0, ... }
     ]
   }
   ```

5. **Verify the ingested state:**

   ```sql
   SELECT source, from_address, subject, attachments_count, company
     FROM inbox_messages
    WHERE company = 'NISLA'
    ORDER BY received_at DESC
    LIMIT 5;
   ```
   - Expected **two** rows: the shared-mailbox PDF and the claim-ref match.
   - The unrelated "Lunch Friday?" email is **absent** — the per-user privacy
     filter dropped it before the full body was ever fetched.

   ```sql
   SELECT COUNT(*) FROM message_attachments WHERE size_bytes > 0;
   ```

   And in the Supabase dashboard → Storage → `comms-attachments`: attachments
   should appear under `comms/NISLA/<YYYY>/<MM>/<message_uuid>/<filename>`.

6. **Confirm Gmail labels.**
   Each processed message in Gmail has the `comms-processed` label applied.
   The next cron tick excludes them via `-label:comms-processed`, so no
   duplicate rows appear in `inbox_messages`.

---

## 6. Troubleshooting

| Symptom                                                       | Likely cause                                                                                               |
|--------------------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| `/api/comms-cron/gmail` returns `401 Unauthorized`            | `CRON_SECRET` env var not set on Vercel, or the `Authorization` header is missing / misspelled             |
| `error=server_misconfigured` in the callback URL              | One of `COMMS_GMAIL_CLIENT_ID/SECRET/REDIRECT_URI` (or `COMMS_USER_REDIRECT_URI`) is missing               |
| `error=state_expired`                                          | User sat on the consent screen for >10 min. Restart the flow.                                              |
| `error=wrong_flow_for_state`                                   | A user nonce is hitting the shared callback (or vice versa). Usually a copy-paste of an old redirect URL.  |
| Cron logs show `Token refresh failed`                         | Google revoked the grant. Have the admin click **Re-connect** on `/communications/mailboxes`.              |
| Per-user opt-in pulled in unrelated mail                      | A regex in `comms_ref_patterns` is too loose. Review `SELECT * FROM comms_ref_patterns WHERE is_active;`.  |
| Attachments missing from Storage but rows in `inbox_messages` | Check `console.warn` lines in Vercel logs tagged `[comms/ingest] storage upload failed`. Likely bucket ACL. |
| Duplicate Gmail messages keep re-ingesting                    | The `comms-processed` label isn't being applied — usually a scope problem. Re-auth with `gmail.modify`.    |

---

## 7. What Week 2 adds (preview, so ops knows what's coming)

- `/api/comms-cron/classify-pending` (separate cron, ~every 5 min) that picks
  each new `inbox_messages` row and classifies it via Claude against the 8
  seeded tags in `tag_definitions`.
- No UI yet — verification via `SELECT workflow_tag, confidence FROM
  message_classifications WHERE is_active`.

Week 3 then brings the actual `/communications` inbox UI.

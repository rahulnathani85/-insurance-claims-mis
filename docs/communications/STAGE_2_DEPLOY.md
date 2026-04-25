# Communications Intelligence — Stage 2 (Delta C) Deployment

This runbook deploys the Stage 2 redesign delta:

- **Core**: collapse the dual Gmail OAuth clients into one
- **+1**: admin/health page now surfaces recent cron activity from `activity_log`
- **+2**: delete the redundant Vercel project (`insurance-claims-mis`)
- **+3**: verify the Classification kill switch end-to-end (mirrors Stage 1's Ingestion test)
- **+4**: PII masker monitoring plan (deferred — exercised on first real email)

> **Scope of Stage 2.** Pure additive code change; no schema migrations.
> The runbook depends on Stage 1 being live and verified.

---

## 1. Google Cloud — add two redirect URIs to the existing OAuth client

The shared-mailbox + per-user-opt-in flows now share a single OAuth 2.0 Client
with the legacy `/api/gmail/auth` flow. Each flow lands on a different redirect
URI registered on the same client.

1. Google Cloud Console → **APIs & Services** → **Credentials**.
2. Open the OAuth 2.0 Client ID `194158601021-...` (the one whose secret is
   stored in Vercel env var `GMAIL_CLIENT_SECRET`).
3. Under **Authorized redirect URIs**, ensure all three are present:
   - `https://insurance-claims-mis-1kl7.vercel.app/api/gmail/callback`
     (legacy — already there)
   - `https://portal.nisla.in/api/communications/mailboxes/callback`
     **(new — add)**
   - `https://portal.nisla.in/api/communications/opt-in/callback`
     **(new — add)**
4. (Optional) For local dev, add the same paths under `http://localhost:3000`.
5. Save.

Propagation is usually instant. If a callback returns
`error=redirect_uri_mismatch` for a few seconds, that's normal —
retry within 30s.

> **Compliance note.** Google's OAuth policy permits one Workspace app to host
> multiple installation modes, provided the consent screen describes the data
> access (it does — `gmail.modify` + `userinfo.email`). At NISLA's user count
> this stays well below the 100-user verification threshold per client.

---

## 2. Vercel — environment variables

### 2.1 Delete the now-unused vars

In **Project Settings → Environments → Production → Environment Variables**,
delete:

- `COMMS_GMAIL_CLIENT_ID`
- `COMMS_GMAIL_CLIENT_SECRET`

(Do this AFTER the Stage 2 commit deploys — see §4. Deleting them earlier won't
break anything since the new code never reads them, but the deploy must be live
first to avoid a window where the old code reads a missing var.)

### 2.2 Add / confirm the URI vars

These three should be present (some of them already are):

| Name | Value |
|---|---|
| `GMAIL_CLIENT_ID` | (existing) |
| `GMAIL_CLIENT_SECRET` | (existing) |
| `COMMS_GMAIL_REDIRECT_URI` | `https://portal.nisla.in/api/communications/mailboxes/callback` |
| `COMMS_USER_REDIRECT_URI` | `https://portal.nisla.in/api/communications/opt-in/callback` |

If `COMMS_GMAIL_REDIRECT_URI` or `COMMS_USER_REDIRECT_URI` is missing, add them.

---

## 3. Vercel — delete the redundant project

You currently have **two Vercel projects connected to the same GitHub repo**:

| Project | Status |
|---|---|
| `insurance-claims-mis-1kl7` | **KEEP** — bound to `portal.nisla.in`, this is production |
| `insurance-claims-mis` | **DELETE** — redundant, no custom domain, double-deploys on every push |

To delete:

1. Vercel dashboard → click into **`insurance-claims-mis`** (NOT the `-1kl7` one!).
2. Verify in **Settings → Domains** that there are no custom domains attached
   (if there are, STOP — that means it's not the redundant one).
3. **Settings → Advanced** → scroll to bottom → **Delete Project**.
4. Type the project name in the confirm dialog → **Delete**.
5. After deletion, your next push to `main` should produce only ONE commit
   status (`Vercel – insurance-claims-mis-1kl7`) instead of two.

---

## 4. Deploy

Standard flow:

```bash
git add lib/comms/gmailClient.js \
        app/api/communications/mailboxes/route.js \
        app/api/communications/mailboxes/callback/route.js \
        app/api/communications/admin/health/route.js \
        app/communications/admin/health/page.js \
        docs/communications/STAGE_2_DEPLOY.md
git commit -m "comms: stage 2 — single OAuth client + admin cron-activity panel"
git push origin main
```

Wait for Vercel to go green (~1 min), then proceed to verification.

---

## 5. Verification

### 5.1 Admin page now surfaces cron activity

Refresh `https://portal.nisla.in/communications/admin/health`. Below the
"Mailbox / kill-switch audit" section, a new section titled **"Recent cron
activity (last 30)"** should be populated with rows like:

| When | Action | Result | Mailboxes | Attempted | OK | Error |
|---|---|---|---|---|---|---|
| `25 Apr, 7:13:06 PM` | `comms_cron_gmail_ingest` | `ok` | `0` | — | — | — |
| `25 Apr, 7:13:06 PM` | `comms_cron_classify_pending` | `ok` | — | `0` | `0` | — |
| `25 Apr, 7:08:06 PM` | `comms_cron_gmail_ingest` | `paused` | — | — | — | — |
| `25 Apr, 6:49:34 PM` | `comms_ingestion_paused` | — | — | — | — | — |

Toggle the kill switch (Pause + Resume on Ingestion) and refresh — new rows
appear at the top.

### 5.2 Classification kill switch (the loose end from Stage 1)

Same proof loop we did for Ingestion:

1. On `/communications/admin/health`, click **Pause** on the **Classification**
   card. Card flips to amber PAUSED.
2. Reply **"paused"** to me — I'll trigger
   `https://portal.nisla.in/api/comms-cron/classify-pending` with the
   `CRON_SECRET` Bearer header.
3. Expected response:
   ```json
   { "ok": true, "skipped": "paused", "pausedSince": "..." }
   ```
4. Click **Resume** on Classification.
5. Reply **"resumed"** — I trigger again.
6. Expected response:
   ```json
   { "ok": true, "attempted": 0, "successful": 0, ... }
   ```
   (`attempted: 0` because no `inbox_messages` exist yet.)

### 5.3 Single-OAuth-client flow (optional — only if you want to actually
       connect a shared mailbox today)

1. On `/communications/mailboxes`, click **Connect NISLA mailbox**.
2. Google's consent screen should show the **existing portal app name** (the
   same one that powers `/email-check`), not a separate "NISLA Comms" app.
3. Sign in with `claim.intimation@nisla.in`.
4. Land back on `/communications/mailboxes` with a green
   "Connected NISLA mailbox …" banner.
5. SQL spot-check:
   ```sql
   SELECT user_email, gmail_address, company, is_comms_mailbox
     FROM gmail_tokens
    WHERE is_comms_mailbox = true;
   ```
   Expect 1 row with `user_email` starting `comms-shared:NISLA:` and
   `gmail_address = 'claim.intimation@nisla.in'`.
6. New `mailbox_audit` row with `event = 'shared_mailbox_connected'`.

If the consent screen flashes a "redirect_uri_mismatch" error, the Google
redirect URI from §1 was either typo'd or not yet propagated — wait 30s and
retry.

### 5.4 PII masker monitoring plan (deferred)

The masker is in the import path of every classifier call (verified by the
local + Vercel build). It will be exercised the first time a real email flows
through ingest+classify. To monitor:

1. Once a shared mailbox is connected (§5.3), send a test email containing:
   ```
   PAN: ABCDE1234F
   Aadhaar: 1234 5678 9012
   Mob: +91 9876543210
   ```
2. Wait for ingest → classify (≤30 s on the next cron tick).
3. In Vercel dashboard → project `insurance-claims-mis-1kl7` → **Functions** →
   click on `/api/comms-cron/classify-pending` → most recent invocation.
4. Search the log for the prompt body sent to the AI. The PAN should appear
   redacted as `A********F`, the Aadhaar as `1************2`, and the mobile
   as `+***********0` (or `0********0` depending on prefix).
5. The plain-text `inbox_messages.body_plain` row in Supabase will still
   contain the original PII — that's intentional (the masker only filters
   what reaches the AI provider, not what we store internally).

If after the first real test the prompt body in Vercel logs still shows raw
PII, that's a regression — file it back as a bug.

---

## 6. Rollback

If anything misbehaves after Stage 2:

1. **Quick stop**: kill switch all three flags from `/communications/admin/health`
   (Ingestion + Classification + Execution) → no further work happens.
2. **Code rollback**: revert the Stage 2 commit and re-push:
   ```bash
   git revert --no-edit <stage-2-sha>
   git push origin main
   ```
3. **OAuth rollback**: if Google flagged the consolidated-client model, restore
   the dual-creds flow by reverting `lib/comms/gmailClient.js` to its previous
   form (the git history has it). Re-add `COMMS_GMAIL_CLIENT_ID/_SECRET` env
   vars in Vercel. The deleted second OAuth client in Google Cloud will need to
   be recreated from scratch — keep the original Client ID/Secret backed up
   somewhere safe before deleting it (it's not deleted by Stage 2 itself).
   (The original Stage 2 plan called this out as the 30-day grace period.)

---

## 7. What Stage 3 changes (preview)

Stage 3 (Delta B) inlines `classifyMessage()` into `ingestFromMailbox` so a new
email lands in `inbox_messages` AND gets classified within the same cron run
(latency drops from 10 min worst-case to 5 min). The `classify-pending` cron
becomes a 15-minute retry sweeper for failed classifications. Separate runbook
when greenlit.

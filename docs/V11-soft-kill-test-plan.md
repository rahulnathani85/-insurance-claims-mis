# V11 Soft-Kill Toggle — Manual Test Plan

Adds a fourth kill switch on `comms_config` (`auto_create_claim_paused`) that short-circuits the AI auto-create-claim handler in `lib/comms/executor.js`. When ON, intimation emails still classify and surface in `/communications/triage`, but no `INTAKE/*` claim shells are auto-created — a human registers the claim manually.

- **Branch:** `chore/supabase-migration-init`
- **Migration:** `supabase/migrations/20260502130000_soft_kill_auto_create_claim.sql` (applied to production schema on 2026-05-02)
- **Files changed:** 5 code/SQL files + this test plan
- **Default state on deploy:** `auto_create_claim_paused = false` — production behavior is unchanged until the operator flips the toggle.
- **Error identifier written to `routing_executions.error` when gated:** `soft_kill_auto_create_claim`

---

## A. Pre-deploy verification

Run from the repo root before pushing to origin.

### A.1 Confirm only the expected files changed

Run BOTH commands:

​```powershell
git diff --stat HEAD
git status --short
​```

`git diff --stat HEAD` shows tracked-and-modified files (4 expected). `git status --short` shows tracked + untracked together (6 expected).

**Expected from `git status --short`:**

​```
 M app/api/communications/admin/health/route.js
 M app/communications/admin/health/page.js
 M lib/comms/executor.js
 M lib/comms/killSwitch.js
?? docs/V11-soft-kill-test-plan.md
?? supabase/migrations/20260502130000_soft_kill_auto_create_claim.sql
​```

Note: `git status --short` may show `supabase/migrations/` as a directory rather than the specific .sql file — that is normal git behaviour for untracked directories. Verify the file exists with `Get-ChildItem supabase/migrations/`.

Pre-existing untracked entries (`.claude/`, `supabase/dumps_2026-04-28/`) predate this work and must NOT be staged. Use `git add` with explicit paths only at B.1, never `git add -A` or `git add -u`.

If anything else appears, **stop** — investigate before committing.

### A.2 Confirm migration columns exist on comms_config

Run in Supabase SQL Editor (project `khtxngncvkwhoaybiigt`, ap-south-1):

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'comms_config'
  AND column_name LIKE 'auto_create_claim%'
ORDER BY ordinal_position;
```

**Expected — 2 rows:**

| column_name | data_type | is_nullable | column_default |
|---|---|---|---|
| `auto_create_claim_paused` | `boolean` | `NO` | `false` |
| `auto_create_claim_paused_at` | `timestamp with time zone` | `YES` | `NULL` |

### A.3 Confirm the toggle is OFF (default state)

```sql
SELECT id,
       auto_create_claim_paused,
       auto_create_claim_paused_at,
       updated_at,
       updated_by
FROM comms_config
WHERE id = 1;
```

**Expected:** `auto_create_claim_paused = false`, `auto_create_claim_paused_at IS NULL`. Production behavior is unchanged.

---

## B. Deploy steps (run in order)

### B.1 Stage the 5 code/SQL files + this test plan

```powershell
git add supabase/migrations/20260502130000_soft_kill_auto_create_claim.sql
git add lib/comms/killSwitch.js
git add lib/comms/executor.js
git add app/api/communications/admin/health/route.js
git add app/communications/admin/health/page.js
git add docs/V11-soft-kill-test-plan.md
```

### B.2 Verify staging is clean

```powershell
git status
```

**Expected:** the 6 paths above appear under "Changes to be committed". Nothing else staged. If other files leaked in, unstage them with `git restore --staged <path>` before committing.

### B.3 Commit

```powershell
git commit -m "feat(comms): soft-kill toggle for AI auto-create-claim from intimation"
```

### B.4 Push (creates a PREVIEW deploy, not production)

```powershell
git push origin chore/supabase-migration-init
```

Pushes the branch to GitHub. This triggers a Vercel **PREVIEW** deployment (not production), since `main` is the production branch. The preview URL appears in the Vercel dashboard within 2–4 minutes.

### B.5 Watch the Vercel preview build

- Open the Vercel dashboard for project `insurance-claims-mis-1kl7`
- Find the deployment matching the commit SHA from B.3
- Build typically takes 2–4 min
- Wait for status `Ready` and the green check on this commit
- The preview URL has the form `https://insurance-claims-mis-<hash>-rahulnathani85-8090s-projects.vercel.app`. **Test the smoke checks (Section C, first pass) against this preview URL first, NOT against portal.nisla.in.**

### B.6 PR review and merge to main

1. Open https://github.com/rahulnathani85/-insurance-claims-mis/compare/main...chore/supabase-migration-init
2. Click **Create pull request**
3. **PR title:** same as the commit message — `feat(comms): soft-kill toggle for AI auto-create-claim from intimation`
4. **PR body:** short description listing the 6 files changed, with a link to `docs/V11-soft-kill-test-plan.md`
5. Verify all CI checks pass on the PR (if any are configured for this repo)
6. Use **Create a merge commit** to match the existing convention in this repo (see PR #11 in `git log`)
7. After merge, Vercel auto-deploys `main` to production at portal.nisla.in (~2–4 min)
8. Wait for the production deploy to show `Ready` in the Vercel dashboard before proceeding to B.7

### B.7 Verify production deployment landed

1. Open https://portal.nisla.in/communications/admin/health
2. Hard refresh (Ctrl+F5) to bypass any browser cache
3. Confirm 4 toggles render — same checks as § C.1, but against the **production URL**, not the preview

---

## C. Post-deploy smoke tests — toggle still OFF

These checks run **twice**:
- **First pass — against the Vercel preview URL** (after B.5, before B.6 merge): catches obvious build breaks before they reach production. Focus is § C.1's page-render check at the preview URL; § C.2 / § C.3 hit the database directly, so they're URL-agnostic and don't need to be repeated for this pass.
- **Second pass — against `portal.nisla.in`** (after B.7, production deploy `Ready`): confirms the merge landed and prod picked up the changes. Run all three sub-sections.

Toggle remains OFF for both passes; production behavior should be unchanged.

### C.1 Admin page renders 4 toggles

1. Open https://portal.nisla.in/communications/admin/health (admin login required)
2. Confirm **4** ScopeToggle cards visible:
   - Ingestion
   - Classification
   - Execution (auto-route)
   - **Auto-create claim from intimation** (the new one)
3. New toggle status pill: green `RUNNING` (paused = false)
4. Description text mentions `/communications/triage` and `INTAKE/*`
5. Header copy reads "Toggle the four pause flags…" (not "three")

If only 3 cards render, the build didn't pick up the page change — re-check the deployment.

### C.2 Auto-create still works with toggle OFF

Confirm a recent `INTAKE/*` claim was auto-created in the past hour (proves the executor is still firing `actionCreateClaim` when the gate is OFF):

```sql
SELECT id, ref_number, intake_message_id, created_at
FROM claims
WHERE ref_number LIKE 'INTAKE/%'
  AND created_at > now() - interval '1 hour'
ORDER BY created_at DESC
LIMIT 5;
```

**Expected:** at least one row from a recent genuine inbound. If 0 rows, sanity-check whether any intimations even arrived in the window:

```sql
SELECT count(*) AS recent_intimations
FROM inbox_messages
WHERE received_at > now() - interval '1 hour';
```

If recent inbox_messages exist but no INTAKE/* claims, **the gate may be firing wrongly** — investigate before Section D.

### C.3 No soft-kill rows exist yet

```sql
SELECT count(*) AS skipped_count
FROM routing_executions
WHERE action_type = 'create_claim'
  AND error      = 'soft_kill_auto_create_claim';
```

**Expected:** `skipped_count = 0`. Nothing has hit the gate yet because the toggle is OFF.

---

## D. Activation — flip toggle ON and verify

This is the live cutover. Run during a quiet inbound window if possible.

### D.1 Flip the toggle

1. On `/communications/admin/health`, click **Pause** on the "Auto-create claim from intimation" card
2. Card should re-render: status pill amber `PAUSED`, "Paused since &lt;timestamp&gt;" line visible
3. Verify in DB:

```sql
SELECT auto_create_claim_paused,
       auto_create_claim_paused_at,
       updated_by,
       updated_at
FROM comms_config
WHERE id = 1;
```

**Expected:** `auto_create_claim_paused = true`, `auto_create_claim_paused_at` set to ~now (UTC), `updated_by` = your admin email.

### D.2 Verify the audit row was recorded

```sql
SELECT created_at, event, actor_email, details
FROM mailbox_audit
WHERE event = 'auto_create_claim_paused'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected:** 1 recent row, `actor_email` = your admin email, `details` ≈ `{"scope":"auto_create_claim","paused":true}`.

### D.3 Send a test intimation email

Send a fresh intimation email to `claim.intimation@nisla.in`. The AI must classify it as `tag='intimation'` for `actionCreateClaim` to even be called — copy the structure of a real recent insurer intimation (insurer name, claim ref, policy no, date of loss, location).

Capture either the email's `Message-ID` header or the exact send time — you'll need it in D.5–D.7.

### D.4 Wait for the cron cycle

Ingestion polls Gmail every 5 min; classification and executor cron cycles run on their own cadence. **Wait up to ~10 min** between sending the email and running the verification queries.

Live progress is visible on `/communications/admin/health`:

- **Recent ingestion runs** — your test email is fetched when a row with `messages_new ≥ 1` appears
- **Recent classification runs** — confirms tagging completed
- **Recent cron activity** — should show recent `comms_cron_*` ticks with `result = ok`

### D.5 Verify the skipped row was written

```sql
SELECT id, message_id, action_type, status, error, executed_at
FROM routing_executions
WHERE action_type = 'create_claim'
  AND error      = 'soft_kill_auto_create_claim'
ORDER BY executed_at DESC
LIMIT 5;
```

**Expected:** at least 1 row, recent `executed_at`, `status = 'skipped'`, `error = 'soft_kill_auto_create_claim'`.

**Capture the `message_id`** from the top row — you'll paste it into D.6 and D.7.

### D.6 Confirm NO new claim was created for that message

```sql
SELECT id, ref_number, intake_message_id, created_at
FROM claims
WHERE intake_message_id = '<paste-message-id-from-D.5>';
```

**Expected:** **0 rows**. The gate fired before the `claims.insert` at executor.js line 174, so no `INTAKE/*` shell exists for this message.

### D.7 Confirm inbox_messages.claim_id stays NULL

```sql
SELECT id, status, claim_id, subject, received_at
FROM inbox_messages
WHERE id = '<paste-message-id-from-D.5>';
```

**Expected:** `status = 'auto_routed'` (the executor's dispatch loop completed normally — only the create_claim handler was skipped), `claim_id IS NULL`. The message is now ready for human triage.

### D.8 (Optional) Confirm message appears in Triage queue

Open `/communications/triage`. The test email should appear in the **Unattended** list with the AI's intimation tag suggestion as a visual hint, awaiting human confirmation.

---

## E. Rollback ladder (least destructive first)

### Level 1 — Toggle OFF in admin UI (the expected rollback)

1. Open `/communications/admin/health`
2. Click **Resume** on the "Auto-create claim from intimation" card
3. Status pill flips back to green `RUNNING`
4. Cache is busted immediately by `bustCommsConfigCache()` in the PATCH handler. The very next executor tick auto-creates as before.
5. Any `INTAKE/*` shells created during prior OFF windows are unaffected. Inbox messages held back during ON time stay where they are — they can be processed via the normal triage flow or, if you want them to flow through auto-create now that it's back on, manually re-trigger their routing.

This is the only rollback you should ever need. **Zero downtime, no deploy, no SQL.**

### Level 2 — Direct SQL toggle (only if admin UI itself is broken)

```sql
UPDATE comms_config
SET auto_create_claim_paused    = false,
    auto_create_claim_paused_at = NULL,
    updated_at                  = now(),
    updated_by                  = 'manual-sql-rollback'
WHERE id = 1;
```

Then either wait 60s for the natural cache TTL to expire, or hit any comms-cron route once to force a fresh read.

### Level 3 — Revert the code (only if the gate code itself is broken)

After B.6 the change lives on `main` (via PR merge), not on `chore/supabase-migration-init`. To revert:

```powershell
git checkout main
git pull origin main
git revert -m 1 <merge-commit-sha-from-B.6>
git push origin HEAD:revert/v11-soft-kill
```

Then open a revert PR from `revert/v11-soft-kill` → `main` and merge it the same way (Create a merge commit). Vercel redeploys `main` to production. The `auto_create_claim_paused*` columns remain in the DB but the JS no longer reads them — harmless dead columns.

Note: `-m 1` tells `git revert` which parent of the merge commit is "mainline" — required for reverting merge commits.

### Level 4 — Drop the columns (catastrophic only — never expected)

The columns default to `false` and the timestamp is nullable; they sit harmlessly on `comms_config` even after a code revert. Only drop them if a separate downstream consumer breaks on their existence (extremely unlikely). Document the reason in writing if you do this.

```sql
ALTER TABLE public.comms_config
  DROP COLUMN IF EXISTS auto_create_claim_paused,
  DROP COLUMN IF EXISTS auto_create_claim_paused_at;
```

---

## Verification checklist (copy into the deploy ticket)

- [ ] A.1 `git diff --stat HEAD` and `git status --short` both show only the 6 expected files
- [ ] A.2 Migration columns exist on `comms_config` with correct types/defaults
- [ ] A.3 Default value is `false`, timestamp is `NULL`
- [ ] B.3 Commit created with the standard message
- [ ] B.5 Vercel build `Ready`, green check on commit
- [ ] C.1 Admin page renders 4 toggles, new one shows `RUNNING` (OFF)
- [ ] C.2 Recent `INTAKE/*` claim found from the past hour (auto-create alive)
- [ ] C.3 Zero `soft_kill_auto_create_claim` rows in `routing_executions`
- [ ] D.1 Toggle flipped ON, timestamp set, `updated_by` correct
- [ ] D.2 `mailbox_audit` row recorded with correct event + actor
- [ ] D.3 Test intimation email sent
- [ ] D.5 Skipped row appears in `routing_executions` with correct error string
- [ ] D.6 No new claim row exists for the test message
- [ ] D.7 `inbox_messages.claim_id IS NULL` for the test message
- [ ] D.8 (Optional) Message visible in `/communications/triage` Unattended queue
- [ ] Rollback ladder reviewed; Level 1 (toggle OFF in UI) confirmed as primary path

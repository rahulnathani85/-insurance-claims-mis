# Communications Intelligence — Stage 3a Deployment

This is the **plumbing-only** sub-stage of the Stage 3 redesign.
Adds schema for human-first triage + dual AI client structure.
**No behavior change** — existing classifier-based flow continues
to work exactly as before. Stage 3b (UI) and 3c (extractor cron)
will switch the system over.

---

## What Stage 3a delivers

| Layer | Adds | Touches |
|---|---|---|
| Schema (`migration_comms_9_human_triage.sql`) | `dismissed` ENUM value, 5 columns on `inbox_messages` (`triaged_by`, `triaged_at`, `dismissed_by`, `dismissed_at`, `dismiss_reason`), `ai_call_log` table | nothing existing — purely additive |
| AI clients (`lib/aiClients/`) | `llmClient.js`, `ocrClient.js`, `aiCallLog.js`, `index.js`, 4 provider files (claude, gemini, mistralOcr, textract) | nothing — `lib/aiClient.js` (the legacy single-client) is left in place |

After Stage 3a deploys, no code path actually invokes the new
clients yet. Existing comms cron + classifier still operate on
the legacy `lib/aiClient.js`. The redesign starts in Stage 3b.

---

## 1. Apply migration in Supabase

Open `supabase/migration_comms_9_human_triage.sql` → paste into
Supabase SQL Editor → Run.

> **Important:** the very first statement is
> `ALTER TYPE message_status ADD VALUE IF NOT EXISTS 'dismissed';`
> Postgres requires this kind of ENUM mutation to be its own
> committed statement before the new value is usable. Supabase's
> SQL Editor commits each top-level statement automatically, so
> running the whole file in one click works fine.

Smoke check:

```sql
-- 1. Confirm the new ENUM value exists
SELECT unnest(enum_range(NULL::message_status))
 ORDER BY 1;
-- expect: auto_routed, classifying, dismissed, error, pending_review,
--         received, rejected
-- (the exact list depends on how your enum was originally seeded; the
--  key signal is 'dismissed' is present)

-- 2. Confirm the new columns are on inbox_messages
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'inbox_messages'
   AND column_name IN ('triaged_by','triaged_at','dismissed_by','dismissed_at','dismiss_reason');
-- expect: 5 rows

-- 3. Confirm ai_call_log is created
SELECT COUNT(*) FROM ai_call_log;  -- expect: 0
```

If all three checks pass, schema is ready.

---

## 2. Vercel — env vars

Stage 3a doesn't strictly require new env vars (no code reads
them yet). But Stage 3c will, and there's no harm in pre-setting
them so the eventual switchover is one push, not two.

**Add when ready** (Vercel dashboard → Settings → Environments
→ Production → Environment Variables):

| Name | Value | Used by |
|---|---|---|
| `ANTHROPIC_API_KEY` | from console.anthropic.com → API Keys | Claude (primary LLM in Stage 3c) |
| `MISTRAL_API_KEY` | from console.mistral.ai → API Keys | Mistral OCR (primary OCR in Stage 3c) |
| `LLM_PROVIDER` | `claude` | Defaults to claude in code; setting explicitly is just for clarity |
| `LLM_MODEL` | `claude-sonnet-4-5-20250929` (or current Sonnet 4.6 model id) | Override per the [Anthropic model docs](https://docs.anthropic.com/en/docs/about-claude/models) |
| `OCR_PROVIDER` | `mistral_ocr` | Same — explicit default |
| `OCR_MODEL` | `mistral-ocr-2503` | Latest GA Mistral OCR model |
| `LLM_INR_PER_USD` | `83` (optional) | Used to estimate cost in INR for `ai_call_log.cost_inr` |
| `OCR_INR_PER_USD` | `83` (optional) | Same |

Existing `GEMINI_API_KEY` stays — kept as the LLM fallback.

For Textract (alternate OCR), set if/when you flip
`OCR_PROVIDER=textract`:

| Name | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM key with `textract:DetectDocumentText` |
| `AWS_SECRET_ACCESS_KEY` | matching secret |
| `AWS_REGION` | `ap-south-1` (Mumbai) recommended for India latency |

Plus you'd need to install the SDK locally:
`npm install @aws-sdk/client-textract`. Stage 3a does NOT install
this since Mistral is the default.

---

## 3. Deploy

Standard flow:

```bash
git add supabase/migration_comms_9_human_triage.sql \
        lib/aiClients/aiCallLog.js \
        lib/aiClients/llmClient.js \
        lib/aiClients/ocrClient.js \
        lib/aiClients/index.js \
        lib/aiClients/utils.js \
        lib/aiClients/providers/claude.js \
        lib/aiClients/providers/gemini.js \
        lib/aiClients/providers/mistralOcr.js \
        lib/aiClients/providers/textract.js \
        docs/communications/STAGE_3A_DEPLOY.md
git commit -m "comms: stage 3a — schema migration 9 + dual AI client plumbing"
git push origin main
```

Vercel auto-deploys (~30 sec). No code path invokes the new
clients yet, so the new env vars need not be set for this deploy
to be healthy.

---

## 4. Verification

Run these in Supabase SQL Editor:

```sql
-- Schema sanity check (same as §1 smoke check)
SELECT
  EXISTS (SELECT 1 FROM pg_type t
            JOIN pg_enum e ON e.enumtypid = t.oid
           WHERE t.typname = 'message_status'
             AND e.enumlabel = 'dismissed')                         AS dismissed_enum_present,
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='inbox_messages'
      AND column_name IN ('triaged_by','triaged_at','dismissed_by',
                          'dismissed_at','dismiss_reason'))         AS triage_cols_count,
  EXISTS (SELECT 1 FROM information_schema.tables
           WHERE table_name = 'ai_call_log')                        AS ai_call_log_exists;
```

Expected: `true, 5, true`.

That's it for Stage 3a verification — there's no runtime to test
yet. Stage 3b adds the triage UI; Stage 3c brings the new clients
online with end-to-end OCR + LLM extraction.

---

## 5. What Stage 3b adds (preview)

- `app/communications/triage/page.js` — triage queue (list of
  `received`-status messages)
- `app/communications/triage/[id]/page.js` — triage detail view
  (subject + body + attachments + tag picker + dismiss button)
- `app/api/communications/triage/route.js` — POST endpoint that
  records the human's triage choice (writes `message_classifications`
  with `classified_by = user.email`, sets status='classifying' or
  'dismissed', audits to `mailbox_audit`)
- New "Triage" sub-link in the comms nav
- Triage queue count card on `/communications` hub

No new AI calls yet — clicking "Confirm tag" just queues the
message for the Stage 3c extractor cron, which arrives next.

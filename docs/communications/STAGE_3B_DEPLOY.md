# Communications Intelligence — Stage 3b Deployment

UI for human-first triage. Builds on Stage 3a's schema (no new
migrations). Still no AI calls — clicking "Confirm tag" just queues
the message for the Stage 3c extractor cron, which lands next.

---

## What Stage 3b delivers

**New pages:**
- `/communications/triage` — the triage queue (filterable list of `received`-status messages)
- `/communications/triage/[id]` — detail view with tag picker + dismiss button

**New API routes:**
- `GET /api/communications/messages` — paginated list, scoped by user's company
- `GET /api/communications/messages/[id]` — full message + attachments + classification history + active tag library
- `POST /api/communications/triage` — records the human's choice (tag or dismiss), audits the event

**Updated:**
- `app/communications/page.js` — hub now shows "Triage queue" card with live count of `received` messages
- `lib/comms/auditLog.js` — adds `recordTriageEvent()` helper

**No new schema. No new env vars.**

---

## Deploy

Vercel auto-redeploys on push. ~30 sec build.

---

## Verification

### 1. Triage queue renders the 19 ingested messages

Sign in to the portal. From `/communications`, click the
"Triage queue" card (badge should show e.g. "19 awaiting").

You should land on `/communications/triage` and see all 19 emails
with subject, sender, attachment count, company, and a relative
timestamp. Default filter is `status=received`.

### 2. Drill into one message

Click any row. You land on `/communications/triage/<id>`:

- Left panel: From / To / Cc / Source headers, full body, and the
  attachment list (filenames + size).
- Right panel: a tag picker (8 tags from `tag_definitions`) and a
  dismiss option in the second tab.

### 3. Dismiss test

On a clearly-not-relevant message (e.g. a marketing email):

1. Click the **Dismiss** tab on the right panel
2. Optionally type a reason like "promotional / not a claim email"
3. Click **Dismiss as not relevant**
4. You're redirected to `/communications/triage`
5. The dismissed message no longer appears in the default queue
6. Switch the filter to "Dismissed" — it's there with the reason

SQL spot-check:

```sql
SELECT id, status, dismissed_by, dismissed_at, dismiss_reason
  FROM inbox_messages
 WHERE status = 'dismissed'
 ORDER BY dismissed_at DESC
 LIMIT 5;
```

And the audit log:

```sql
SELECT created_at, action, user_email, details
  FROM activity_log
 WHERE action = 'comms_message_dismissed'
 ORDER BY created_at DESC
 LIMIT 5;
```

### 4. Categorise test

On a real claim-related message:

1. Stay on the **Categorise** tab
2. Click one of the 8 tag buttons (e.g. "New Intimation" if it's an
   insurer intimation email)
3. Click **Confirm tag: New Intimation**
4. You're redirected to `/communications/triage`; the message
   leaves the default queue
5. Switch the filter to "Triaged (extracting)" — it's there

SQL spot-check:

```sql
SELECT m.id, m.status, m.triaged_by, m.triaged_at,
       c.tag, c.classifier_model, c.classified_by, c.is_active
  FROM inbox_messages m
  JOIN message_classifications c ON c.message_id = m.id
 WHERE m.status = 'classifying' AND c.is_active = true
 ORDER BY m.triaged_at DESC
 LIMIT 5;
```

Expected: triaged_by = your email; classifier_model = 'human';
classified_by = 'manual:<your email>'; confidence = 1.00.

### 5. Hub card live count

Refresh `/communications`. The "Triage queue" card should now show
a smaller "awaiting" count (you've drained 1-2 messages).

---

## What's NOT happening yet

- Categorised messages sit in `status='classifying'` indefinitely.
  No AI extraction runs on them.
- The legacy `classify-pending` cron is still PAUSED (good — it's
  now obsolete; Stage 3c retires it formally).
- The new dual AI clients (`lib/aiClients/llmClient.js`,
  `ocrClient.js`) are still dormant — nothing imports them.

That's all by design. Stage 3c brings the new extractor cron
online and finally exercises the OCR + LLM pipeline.

---

## Rollback

If anything misbehaves:

1. Triage UI is read-mostly; no destructive operations possible
   from it. Worst case: a wrong tag choice. Re-triage is not
   exposed yet — to manually un-do, run:

   ```sql
   UPDATE inbox_messages
      SET status = 'received',
          triaged_by = NULL,
          triaged_at = NULL
    WHERE id = '<message-uuid>';

   UPDATE message_classifications
      SET is_active = false
    WHERE message_id = '<message-uuid>';
   ```

2. Code rollback: revert the Stage 3b commit and re-push.

---

## What Stage 3c adds (preview)

- `lib/comms/attachmentReader.js` — downloads attachment from
  Storage and runs through `ocrClient.extractText`
- `lib/comms/triageExtractor.js` — OCR-then-LLM orchestration on a
  single triaged message
- `app/api/comms-cron/extract-pending/route.js` — sweeper cron
  picking `status='classifying'` rows lacking extraction_results
- `vercel.json` — replace `classify-pending` cron with
  `extract-pending` (same `*/15` cadence)
- `app/api/comms-cron/classify-pending/route.js` — deprecate (return
  no-op, keep route for backward compat)

Env vars required at Stage 3c boot:
- `ANTHROPIC_API_KEY` (Claude)
- `MISTRAL_API_KEY` (Mistral OCR)

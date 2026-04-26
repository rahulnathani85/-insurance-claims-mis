# Communications Intelligence — Stage 3c Deployment

The final Stage 3 sub-stage. Brings the OCR + LLM extractor cron
online so messages a human triages actually get processed by AI.

After this deploys, the comms module is **end-to-end functional**:

```
Email arrives → ingested → triage queue → human picks tag
                                              ↓
                                  extract-pending cron tick
                                              ↓
                              OCR (Mistral) → LLM (Claude) → extraction_results
                                              ↓
                                       status='pending_review'
                                              ↓
                                   (Stage 5 will auto-route from here)
```

---

## What Stage 3c delivers

**New code:**
- `lib/comms/attachmentReader.js` — downloads attachments from Storage, runs OCR via `lib/aiClients/extractText`. Skips non-PDF/image attachments. 25 MB cap. Per-attachment failures non-fatal.
- `lib/comms/prompts/extractPrompt.js` — extraction-only prompt builder. Tag is given upfront; LLM only extracts fields per the tag's `extraction_schema`. Two blueprint-sourced few-shots (intimation + settlement_advice).
- `lib/comms/triageExtractor.js` — orchestrates the pipeline. `extractTriagedMessage(messageId)` for one message, `extractPendingBatch({ limit })` for the cron sweeper.
- `app/api/comms-cron/extract-pending/route.js` — Vercel cron route, `*/5 * * * *`. Bearer secret auth. Respects `comms_config.classification_paused` kill switch (same flag — semantically still the AI step).

**Touched:**
- `lib/comms/piiMasker.js` — adds `wrapCallLLM()` wrapper that masks PII then calls the new `lib/aiClients/callLLM` (Claude primary). Existing `wrapCallAI` (legacy) untouched.
- `app/api/comms-cron/classify-pending/route.js` — **deprecated**. Returns `{ deprecated: true, replacement: '/api/comms-cron/extract-pending', ... }` with a 200 OK. Nothing imports the old `lib/comms/classifier.js` from this path anymore.
- `vercel.json` — replaced the `classify-pending` cron entry with `extract-pending`. Same `*/5 * * * *` cadence.

**Not removed (intentional):**
- `lib/comms/classifier.js` — kept on disk as legacy reference / future emergency fallback. Nothing in the active code path imports it for the auto-classify flow.

**No new schema, no new env vars** — Stage 3a already provisioned everything we need.

---

## Required env vars (set in Stage 3a, confirm they're still there)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude Sonnet (LLM extraction primary) |
| `MISTRAL_API_KEY` | Mistral OCR (OCR primary) |
| `CRON_SECRET` | Cron Bearer auth |
| `SUPABASE_SERVICE_ROLE_KEY` | DB writes |
| `NEXT_PUBLIC_SUPABASE_URL` | (existing) |

Optional overrides:

| Variable | Default if unset |
|---|---|
| `LLM_PROVIDER` | `claude` |
| `LLM_MODEL` | `claude-sonnet-4-5-20250929` |
| `OCR_PROVIDER` | `mistral_ocr` |
| `OCR_MODEL` | `mistral-ocr-2503` |
| `LLM_INR_PER_USD` | `83` (for cost estimates in `ai_call_log`) |
| `OCR_INR_PER_USD` | `83` |

---

## Deploy

Standard flow. Vercel auto-redeploys on push (~30 sec).

The cron schedule change in `vercel.json` only takes effect after
the new deploy is live; before that, the OLD `classify-pending`
schedule may fire one more time, hit the now-deprecated route, and
return a friendly no-op.

---

## Verification

### 1. The new cron is registered

After deploy goes green:
- Vercel dashboard → project → **Cron Jobs** in left sidebar
- You should see two entries:
  - `/api/comms-cron/gmail` `*/5 * * * *`
  - `/api/comms-cron/extract-pending` `*/5 * * * *`
- The old `/api/comms-cron/classify-pending` should NOT appear (Vercel removes
  cron registrations not present in `vercel.json`).

### 2. Smoke test: trigger the cron with no triaged messages

Should be a fast no-op since nothing is in `classifying` status if
you haven't triaged anything yet.

```bash
curl -X POST https://portal.nisla.in/api/comms-cron/extract-pending \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expected:
```json
{
  "ok": true,
  "attempted": 0,
  "successful": 0,
  "failed": 0,
  "skipped": 0,
  "totalOcrPages": 0,
  "totalCostInr": 0,
  ...
}
```

### 3. End-to-end test (the real one)

a. From `/communications/triage`, **categorise one real email**.
   Pick a tag with a real extraction_schema (e.g. `intimation` or
   `settlement_advice`). Click Confirm tag.

b. Wait for the next `*/5` cron tick + 30s. Or trigger manually
   with the curl above.

c. SQL spot-checks:

```sql
-- 3a. The triaged message moved from classifying → pending_review
SELECT id, status, triaged_by, triaged_at
  FROM inbox_messages
 WHERE triaged_at IS NOT NULL
 ORDER BY triaged_at DESC
 LIMIT 5;

-- 3b. extraction_results now has a row
SELECT message_id, tag, is_valid,
       jsonb_pretty(extracted_data) AS extracted_data,
       validation_errors
  FROM extraction_results
 ORDER BY created_at DESC
 LIMIT 5;

-- 3c. ai_call_log shows BOTH an ocr call and a llm call for that message
SELECT created_at, scope, provider, model, tokens_in, tokens_out,
       pages, cost_inr, latency_ms
  FROM ai_call_log
 ORDER BY created_at DESC
 LIMIT 10;

-- 3d. PII test — if your test message contained PAN/Aadhaar/mobile,
-- they'd be redacted in the prompt sent to Claude. Check Vercel
-- function logs (Functions → /api/comms-cron/extract-pending →
-- recent invocation) for the actual prompt body. PII should appear
-- masked: A********F, 1************2, etc.
```

Expected for 3a: status='pending_review', triaged_by=your email.
Expected for 3b: 1 row with is_valid=true, extracted_data populated
with the schema fields (e.g. for intimation: policy_no, insured_name,
date_of_loss, etc.).
Expected for 3c: 1 row with scope='llm' (Claude); for tags with
extraction_schema and PDF/image attachments, also 1+ rows with
scope='ocr' (Mistral OCR).

### 4. Cost dashboard preview

```sql
-- Total spend per provider in last 24h
SELECT provider, scope, COUNT(*) AS calls,
       SUM(cost_inr) AS total_inr,
       SUM(tokens_in) AS total_tokens_in,
       SUM(tokens_out) AS total_tokens_out,
       SUM(pages) AS total_pages,
       AVG(latency_ms)::int AS avg_latency_ms
  FROM ai_call_log
 WHERE created_at > now() - interval '24 hours'
 GROUP BY provider, scope
 ORDER BY total_inr DESC;
```

---

## Kill switch behavior

The Classification kill switch (currently ON from yesterday) is
respected by the new cron. Click **Resume** on the Classification
card on `/communications/admin/health` when you're ready to let
extraction run.

If you leave it paused, triaged messages just queue indefinitely
until you flip it.

---

## Rollback

If anything misbehaves:

1. **Pause Classification** on `/communications/admin/health`.
   Triage UI keeps working (humans can still triage), extraction
   pauses cleanly.
2. **Code rollback**: revert the Stage 3c commit and re-push.
   Schema migration 9 stays in place — it's additive and the rest
   of the system keeps working.
3. **Manual recovery for any error-status messages**:
   ```sql
   UPDATE inbox_messages
      SET status = 'classifying'
    WHERE status = 'error'
      AND triaged_at IS NOT NULL;  -- only re-queue triaged messages
   ```
   Next cron tick will retry the extraction.

---

## What's next (Stage 4 preview)

- `app/api/comms-webhooks/gmail/route.js` — Gmail Push receiver via
  Pub/Sub. Drops latency from 5 min poll → seconds.
- `app/api/comms-cron/refresh-watch/route.js` — daily cron to renew
  the `users.watch` subscription before the 7-day expiry.
- Demote the existing 5-min polling cron to hourly fallback.

Stage 4 is OPTIONAL polish — Stage 3c is the functional finish line.

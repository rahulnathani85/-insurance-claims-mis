-- =============================================================================
-- Slice G: notification_queue (registration spec §11)
-- =============================================================================
-- 30 Apr 2026
--
-- Outbound notification queue. Entries are inserted by /api/claims/[id]/register
-- and /api/claims/[id]/team-assign, then processed by a Vercel cron at
-- /api/comms-cron/send-notifications.
--
-- Spec §11 calls for both email and WhatsApp. Phase 1 ships email-only;
-- WhatsApp goes via a separate provider (Interakt / Gupshup / MSG91) and is
-- deferred. The `channel` column is in place so adding WA later is additive.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.notification_queue (
    id                 BIGSERIAL    PRIMARY KEY,

    notification_type  TEXT         NOT NULL,
    channel            TEXT         NOT NULL DEFAULT 'email',

    claim_id           BIGINT       REFERENCES public.claims(id) ON DELETE CASCADE,
    recipient_email    TEXT,
    recipient_name     TEXT,
    recipient_phone    TEXT,

    subject            TEXT,
    body_text          TEXT,
    body_html          TEXT,

    context            JSONB        NOT NULL DEFAULT '{}'::jsonb,

    status             TEXT         NOT NULL DEFAULT 'pending',
    attempt_count      INTEGER      NOT NULL DEFAULT 0,
    max_attempts       INTEGER      NOT NULL DEFAULT 3,
    last_attempt_at    TIMESTAMPTZ,
    last_error         TEXT,

    scheduled_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    sent_at            TIMESTAMPTZ,

    company            TEXT         NOT NULL DEFAULT 'NISLA',
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by         TEXT
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_queue_status_check') THEN
        ALTER TABLE public.notification_queue
            ADD CONSTRAINT notification_queue_status_check
            CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_queue_channel_check') THEN
        ALTER TABLE public.notification_queue
            ADD CONSTRAINT notification_queue_channel_check
            CHECK (channel IN ('email', 'whatsapp', 'log'));
    END IF;
END $$;

-- Cron picks up rows where status='pending' and scheduled_at <= now() and
-- attempt_count < max_attempts. Index supports that scan.
CREATE INDEX IF NOT EXISTS idx_notification_queue_pickup
    ON public.notification_queue (status, scheduled_at)
    WHERE status IN ('pending', 'sending');

CREATE INDEX IF NOT EXISTS idx_notification_queue_claim_id
    ON public.notification_queue (claim_id)
    WHERE claim_id IS NOT NULL;

ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'notification_queue'
          AND policyname = 'Allow all access to notification_queue'
    ) THEN
        CREATE POLICY "Allow all access to notification_queue" ON public.notification_queue
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.notification_queue
    IS 'Spec §11: outbound notifications queue. Email today, WhatsApp/SMS deferred. Cron at /api/comms-cron/send-notifications drains rows where status=pending and scheduled_at <= now().';
COMMENT ON COLUMN public.notification_queue.scheduled_at
    IS 'Earliest send time. ILA-due reminders use future timestamps (T-24h, T-6h relative to ila_due_at) so the cron picks them up at the right moment.';
COMMENT ON COLUMN public.notification_queue.status
    IS 'pending -> sending -> sent | failed (retry until attempt_count >= max_attempts) | cancelled (manual abort).';

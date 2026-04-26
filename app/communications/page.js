'use client';

// ============================================================
// /communications
// ------------------------------------------------------------
// Week 1 landing page for the Communications Intelligence module.
// The actual inbox UI arrives in Week 3 (filter + list + detail).
// Until then this hub surfaces:
//   - "Scan my Gmail" (everyone)     -> /communications/opt-in
//   - "Shared mailboxes" (admin only) -> /communications/mailboxes
//   - A status line indicating ingestion is configured but not
//     yet classifying (classifier lands in Week 2).
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

export default function CommunicationsHomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [queueCount, setQueueCount] = useState(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  // Live count of messages awaiting triage. Refresh every 60s.
  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const res = await fetch(
          '/api/communications/messages?status=received&limit=1&offset=0',
          {
            headers: { 'x-app-user-email': user.email },
            cache: 'no-store',
          }
        );
        const json = await res.json();
        if (!cancelled && res.ok) setQueueCount(json.total || 0);
      } catch {
        // Non-fatal — leave queueCount null.
      }
    };
    fetchCount();
    const t = setInterval(fetchCount, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [user?.email]);

  const isAdmin = user?.role === 'Admin';

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 960, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22, color: '#1e293b' }}>
            Communications Intelligence
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b', maxWidth: 720 }}>
            Human-first triage of claim-related emails (and soon WhatsApp).
            Shared company mailboxes and opted-in user inboxes are polled
            every 5 minutes; messages land in the triage queue for human
            categorisation. AI extraction (OCR + LLM) runs only on
            categorised messages.
          </p>
        </div>

        <div style={{
          display: 'grid', gap: 14, marginTop: 4,
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        }}>
          <HubCard
            title="Triage queue"
            description="Read each new message and pick a workflow tag (or dismiss if not relevant). Only categorised messages move on to AI extraction."
            href="/communications/triage"
            ctaLabel="Open triage queue"
            badge={
              queueCount === null
                ? null
                : queueCount === 0
                ? '0 to triage'
                : `${queueCount} awaiting`
            }
            badgeKind={queueCount > 0 ? 'urgent' : 'ok'}
          />

          <HubCard
            title="Scan my Gmail"
            description="Opt your own work Gmail in as a secondary source. Only messages matching a claim-reference pattern are read."
            href="/communications/opt-in"
            ctaLabel="Open opt-in"
          />

          {isAdmin ? (
            <HubCard
              title="Shared mailboxes"
              description="Connect one Gmail inbox per company (e.g. claim.intimation@nisla.in). These are the primary ingestion source."
              href="/communications/mailboxes"
              ctaLabel="Manage mailboxes"
              adminBadge
            />
          ) : (
            <HubCard
              title="Shared mailboxes"
              description="Admin-only. Ask an admin to connect the NISLA and Acuere shared inboxes from the mailboxes page."
              disabled
              adminBadge
            />
          )}
        </div>

        <div style={{ ...infoBoxStyle, marginTop: 18 }}>
          <strong style={{ display: 'block', marginBottom: 6, color: '#0f172a' }}>
            How a message moves through the system
          </strong>
          <ol style={{ margin: 0, padding: '0 0 0 18px', color: '#334155', fontSize: 13, lineHeight: 1.6 }}>
            <li>Email arrives at a connected mailbox &rarr; ingested into <code style={codeStyle}>inbox_messages</code> with status <code style={codeStyle}>received</code>.</li>
            <li>Human opens triage queue &rarr; picks a workflow tag <em>or</em> dismisses as not relevant.</li>
            <li>If categorised: AI runs OCR on attachments &rarr; LLM extracts structured fields per the chosen tag&apos;s schema.</li>
            <li>High-confidence extractions auto-route into the relevant claim; uncertain ones queue for review.</li>
            <li>Dismissed messages are terminal &mdash; AI never runs on them.</li>
          </ol>
        </div>
      </div>
    </PageLayout>
  );
}

// ------------------------------------------------------------
// sub-components
// ------------------------------------------------------------
function HubCard({ title, description, href, ctaLabel, disabled, adminBadge, badge, badgeKind }) {
  const badgeColors = {
    ok:     { bg: '#ecfdf5', fg: '#065f46' },
    urgent: { bg: '#fef3c7', fg: '#92400e' },
    err:    { bg: '#fef2f2', fg: '#991b1b' },
  };
  const c = badgeColors[badgeKind] || badgeColors.ok;
  const inner = (
    <div style={{
      ...cardStyle,
      opacity: disabled ? 0.6 : 1,
      cursor: disabled ? 'not-allowed' : 'default',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{title}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {badge && (
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: c.fg, background: c.bg,
              padding: '2px 8px', borderRadius: 999, letterSpacing: 0.4,
            }}>{badge}</span>
          )}
          {adminBadge && (
            <span style={{
              fontSize: 10, fontWeight: 700,
              color: '#5b21b6', background: '#ede9fe',
              padding: '2px 7px', borderRadius: 999, letterSpacing: 0.5,
            }}>ADMIN</span>
          )}
        </div>
      </div>
      <p style={{ margin: '8px 0 14px', fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
        {description}
      </p>
      {!disabled && (
        <span style={ctaStyle}>{ctaLabel} &rarr;</span>
      )}
    </div>
  );

  if (disabled) return inner;
  return <Link href={href} style={{ textDecoration: 'none' }}>{inner}</Link>;
}

function Banner({ kind, children }) {
  const map = {
    ok:   { bg: '#ecfdf5', fg: '#065f46', bd: '#a7f3d0' },
    warn: { bg: '#fffbeb', fg: '#92400e', bd: '#fde68a' },
    err:  { bg: '#fef2f2', fg: '#991b1b', bd: '#fecaca' },
  };
  const c = map[kind] || map.warn;
  return (
    <div style={{
      background: c.bg, color: c.fg,
      border: `1px solid ${c.bd}`,
      padding: '10px 14px', borderRadius: 8,
      fontSize: 13,
    }}>
      {children}
    </div>
  );
}

// ------------------------------------------------------------
// inline styles
// ------------------------------------------------------------
const cardStyle = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: 16,
  boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
  transition: 'border-color 120ms ease',
  minHeight: 140,
};

const infoBoxStyle = {
  ...cardStyle,
  boxShadow: 'none',
  background: '#f8fafc',
};

const ctaStyle = {
  display: 'inline-block',
  fontSize: 12, fontWeight: 600,
  color: '#1e3a5f',
};

const codeStyle = {
  background: '#e2e8f0',
  padding: '1px 5px',
  borderRadius: 4,
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#0f172a',
};

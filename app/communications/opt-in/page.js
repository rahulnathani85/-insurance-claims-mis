'use client';

// ============================================================
// /communications/opt-in
// ------------------------------------------------------------
// User-facing page. Lets the signed-in user opt their own Gmail
// in as a secondary ingestion source for the Communications
// Intelligence module.
//
// Privacy contract surfaced to the user:
//   Only messages whose subject/snippet match a claim-reference
//   regex for the chosen company are ever fetched beyond headers.
//   The full body, HTML, and attachments of non-matching messages
//   are never touched.
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

const COMPANIES = ['NISLA', 'Acuere'];

export default function CommsOptInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('NISLA');

  const fetchStatus = useCallback(async () => {
    if (!user?.email) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/communications/opt-in', {
        headers: { 'x-app-user-email': user.email },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load status');
      setStatus(data);
      if (data.company && COMPANIES.includes(data.company)) {
        setSelectedCompany(data.company);
      } else if (user.company && COMPANIES.includes(user.company)) {
        // Default to the user's own company if they haven't opted in yet.
        setSelectedCompany(user.company);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Redirect unauthenticated users to login.
  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user?.email) fetchStatus();
  }, [user, fetchStatus]);

  // Surface OAuth callback results via query string.
  const qsError = searchParams.get('error');
  const qsOptedIn = searchParams.get('opted_in');
  const qsEmail = searchParams.get('email');
  const qsCompany = searchParams.get('company');

  async function handleOptIn() {
    if (!user?.email) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/communications/opt-in', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-user-email': user.email,
        },
        body: JSON.stringify({ company: selectedCompany }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start OAuth');
      if (!data.consent_url) throw new Error('No consent URL returned');
      window.location.href = data.consent_url;
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  async function handleOptOut() {
    if (!user?.email) return;
    if (!confirm(
      'Stop scanning your Gmail for claim-related messages?\n\n' +
      'Your Gmail connection itself will remain in place so that the ' +
      'email-check feature keeps working.'
    )) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/communications/opt-in', {
        method: 'DELETE',
        headers: { 'x-app-user-email': user.email },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to opt out');
      await fetchStatus();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22, color: '#1e293b' }}>
            Scan my Gmail for claim messages
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b' }}>
            Optionally let the Communications module pick up claim-related
            messages that arrive on your work Gmail (e.g., surveyors copying
            you directly). Only messages whose subject or preview match a
            known claim reference are read &mdash; nothing else.
          </p>
        </div>

        {qsOptedIn && (
          <Banner kind="ok">
            Opted in. <strong>{qsEmail}</strong> is now connected for{' '}
            <strong>{qsCompany}</strong> claim-message scanning.
          </Banner>
        )}
        {qsError && (
          <Banner kind="err">OAuth error: {qsError.replace(/_/g, ' ')}</Banner>
        )}
        {error && <Banner kind="err">{error}</Banner>}

        <div style={boxStyle}>
          <strong style={{ display: 'block', marginBottom: 8, color: '#0f172a', fontSize: 14 }}>
            Privacy
          </strong>
          <ul style={{ margin: 0, padding: '0 0 0 18px', color: '#334155', fontSize: 13, lineHeight: 1.6 }}>
            <li>
              Before reading any message, we check its subject and short preview
              against your company&rsquo;s claim-reference patterns
              (e.g., <code style={codeStyle}>C-2026-1234</code>,{' '}
              <code style={codeStyle}>EW-ABC-1234</code>).
            </li>
            <li>
              If nothing matches, the message body and attachments are never
              fetched or stored.
            </li>
            <li>
              Matching messages are pulled into the shared Communications inbox
              so ops can triage them alongside the shared mailbox.
            </li>
            <li>
              You can opt out any time &mdash; this only flips a flag; your
              Gmail connection stays in place for other features.
            </li>
          </ul>
        </div>

        {loading ? (
          <p style={{ marginTop: 16, fontSize: 12, color: '#64748b' }}>Loading...</p>
        ) : (
          <div style={{ ...boxStyle, marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                Current status
              </div>
              <span style={{
                fontSize: 11, fontWeight: 600,
                color: status?.opted_in ? '#15803d' : '#b45309',
                background: status?.opted_in ? '#dcfce7' : '#fef3c7',
                padding: '3px 8px', borderRadius: 999,
              }}>
                {status?.opted_in ? 'Opted in' : 'Not opted in'}
              </span>
            </div>

            {status?.opted_in ? (
              <div style={{ marginTop: 12, fontSize: 13, color: '#334155' }}>
                <div><strong>Gmail:</strong> {status.gmail_address}</div>
                <div><strong>Company:</strong> {status.company}</div>
                {status.updated_at && (
                  <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>
                    Last updated: {new Date(status.updated_at).toLocaleString()}
                  </div>
                )}
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleOptIn}
                    style={btnSecondary}
                  >
                    Re-authorize
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleOptOut}
                    style={btnDanger}
                  >
                    Stop scanning my Gmail
                  </button>
                </div>
                <p style={{ margin: '10px 0 0', fontSize: 11, color: '#64748b' }}>
                  Re-authorize if Google revoked the grant or you want to
                  refresh permissions.
                </p>
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#475569', marginBottom: 4 }}>
                  Which company&rsquo;s claim-reference patterns should apply?
                </label>
                <select
                  value={selectedCompany}
                  onChange={(e) => setSelectedCompany(e.target.value)}
                  disabled={saving}
                  style={selectStyle}
                >
                  {COMPANIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleOptIn}
                  style={{ ...btnPrimary, marginTop: 12 }}
                >
                  {saving ? 'Starting...' : 'Opt in with Google'}
                </button>
                <p style={{ margin: '10px 0 0', fontSize: 11, color: '#64748b' }}>
                  You&rsquo;ll be redirected to Google to grant access. If you
                  already connected your Gmail for the email-check feature,
                  you may not see a second consent screen.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </PageLayout>
  );
}

// ------------------------------------------------------------
// inline styles
// ------------------------------------------------------------
const boxStyle = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: 16,
  boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
  marginTop: 18,
};

const btnBase = {
  padding: '7px 14px',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 6,
  cursor: 'pointer',
  border: '1px solid transparent',
};

const btnPrimary = {
  ...btnBase,
  background: '#1e3a5f',
  color: '#fff',
};

const btnSecondary = {
  ...btnBase,
  background: '#f1f5f9',
  color: '#0f172a',
  borderColor: '#cbd5e1',
};

const btnDanger = {
  ...btnBase,
  background: '#fef2f2',
  color: '#b91c1c',
  borderColor: '#fecaca',
};

const selectStyle = {
  width: '100%',
  padding: '7px 10px',
  fontSize: 13,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  background: '#fff',
  color: '#0f172a',
};

const codeStyle = {
  background: '#f1f5f9',
  padding: '1px 5px',
  borderRadius: 4,
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#0f172a',
};

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
      fontSize: 13, marginTop: 12,
    }}>
      {children}
    </div>
  );
}

'use client';

// ============================================================
// /communications/mailboxes
// ------------------------------------------------------------
// Admin page to connect and manage shared Gmail mailboxes for
// the Communications Intelligence module. One shared mailbox
// per company (NISLA, Acuere).
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

const ALLOWED_COMPANIES = ['NISLA', 'Acuere'];

export default function CommsMailboxesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const [mailboxes, setMailboxes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyCompany, setBusyCompany] = useState(null);

  const isAdmin = user?.role === 'Admin';

  const fetchMailboxes = useCallback(async () => {
    if (!user?.email) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/communications/mailboxes', {
        headers: { 'x-app-user-email': user.email },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load mailboxes');
      setMailboxes(data.mailboxes || []);
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
    if (user?.email) fetchMailboxes();
  }, [user, fetchMailboxes]);

  // Surface callback errors / success via query string.
  const qsError = searchParams.get('error');
  const qsConnected = searchParams.get('connected');
  const qsEmail = searchParams.get('email');
  const qsCompany = searchParams.get('company');

  async function handleConnect(company) {
    if (!user?.email) return;
    setBusyCompany(company);
    setError('');
    try {
      const res = await fetch('/api/communications/mailboxes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-user-email': user.email,
        },
        body: JSON.stringify({ company }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start OAuth');
      if (!data.consent_url) throw new Error('No consent URL returned');
      window.location.href = data.consent_url;
    } catch (e) {
      setError(e.message);
      setBusyCompany(null);
    }
  }

  async function handleDisconnect(mailbox) {
    if (!user?.email) return;
    if (!confirm(`Disconnect ${mailbox.company} shared mailbox (${mailbox.gmail_address})?`)) return;
    setError('');
    try {
      const res = await fetch('/api/communications/mailboxes', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-app-user-email': user.email,
        },
        body: JSON.stringify({ mailbox_id: mailbox.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to disconnect');
      await fetchMailboxes();
    } catch (e) {
      setError(e.message);
    }
  }

  const connectedByCompany = Object.fromEntries(
    mailboxes.map((m) => [m.company, m])
  );

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 960, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22, color: '#1e293b' }}>
            Shared Mailboxes
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b' }}>
            Connect a shared Gmail inbox for each company. The Communications
            module will poll these mailboxes every 5 minutes and classify
            incoming messages automatically.
          </p>
        </div>

        {!isAdmin && (
          <Banner kind="warn">
            This page is read-only. Only admins can connect or disconnect shared mailboxes.
          </Banner>
        )}

        {qsConnected && (
          <Banner kind="ok">
            Connected {qsCompany} mailbox <strong>{qsEmail}</strong>.
          </Banner>
        )}
        {qsError && (
          <Banner kind="err">OAuth error: {qsError.replace(/_/g, ' ')}</Banner>
        )}
        {error && <Banner kind="err">{error}</Banner>}

        <div style={{
          display: 'grid', gap: 14, marginTop: 18,
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
        }}>
          {ALLOWED_COMPANIES.map((company) => {
            const connected = connectedByCompany[company];
            return (
              <div key={company} style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{company}</div>
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: connected ? '#15803d' : '#b45309',
                    background: connected ? '#dcfce7' : '#fef3c7',
                    padding: '3px 8px', borderRadius: 999,
                  }}>
                    {connected ? 'Connected' : 'Not connected'}
                  </span>
                </div>

                {connected ? (
                  <div style={{ marginTop: 12, fontSize: 13, color: '#334155' }}>
                    <div><strong>Mailbox:</strong> {connected.gmail_address}</div>
                    {connected.updated_at && (
                      <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>
                        Last refreshed: {new Date(connected.updated_at).toLocaleString()}
                      </div>
                    )}
                    <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        disabled={!isAdmin || busyCompany === company}
                        onClick={() => handleConnect(company)}
                        style={btnSecondary}
                      >
                        Re-connect
                      </button>
                      <button
                        type="button"
                        disabled={!isAdmin}
                        onClick={() => handleDisconnect(connected)}
                        style={btnDanger}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 12 }}>
                    <p style={{ margin: '0 0 12px', fontSize: 12, color: '#64748b' }}>
                      Sign in with the {company} ops Gmail account (e.g.
                      {company === 'NISLA' ? ' claim.intimation@nisla.in' : ' claims@acuere.in'}).
                      You will be redirected to Google.
                    </p>
                    <button
                      type="button"
                      disabled={!isAdmin || busyCompany === company}
                      onClick={() => handleConnect(company)}
                      style={btnPrimary}
                    >
                      {busyCompany === company ? 'Starting...' : `Connect ${company} mailbox`}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {loading && (
          <p style={{ marginTop: 18, fontSize: 12, color: '#64748b' }}>Loading...</p>
        )}
      </div>
    </PageLayout>
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
      fontSize: 13, marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

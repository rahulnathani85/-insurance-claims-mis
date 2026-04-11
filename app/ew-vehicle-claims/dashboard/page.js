'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useCompany } from '@/lib/CompanyContext';

const STATUS_LIST = ['Open', 'In Progress', 'Assessment', 'Report Ready', 'Completed', 'Closed'];

const STATUS_COLORS = {
  'Open':         { bg: '#dbeafe', color: '#1e40af', border: '#93c5fd' },
  'In Progress':  { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
  'Assessment':   { bg: '#fce7f3', color: '#9d174d', border: '#f9a8d4' },
  'Report Ready': { bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' },
  'Completed':    { bg: '#dcfce7', color: '#166534', border: '#86efac' },
  'Closed':       { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
};

export default function EWDashboard() {
  const router = useRouter();
  const { company } = useCompany();
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadClaims(); }, [company]);

  async function loadClaims() {
    try {
      setLoading(true);
      const url = `/api/ew-claims?company=${encodeURIComponent(company)}&t=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      setClaims(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load EW claims:', e);
      setClaims([]);
    } finally {
      setLoading(false);
    }
  }

  // Stats
  const total = claims.length;
  const statusCounts = {};
  STATUS_LIST.forEach(s => { statusCounts[s] = claims.filter(c => c.status === s).length; });
  const notStartedCount = claims.filter(c => c._needs_ew_setup).length;
  const active = statusCounts['Open'] + statusCounts['In Progress'] + statusCounts['Assessment'];
  const completed = statusCounts['Completed'] + statusCounts['Closed'];

  // Stage distribution
  const stageCounts = {};
  for (let i = 1; i <= 12; i++) stageCounts[i] = 0;
  claims.forEach(c => {
    const s = parseInt(c.current_stage);
    if (s >= 1 && s <= 12) stageCounts[s]++;
  });
  const maxStage = Math.max(1, ...Object.values(stageCounts));

  // Recent claims (last 5)
  const recent = [...claims]
    .filter(c => c.created_at)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);

  // This month
  const now = new Date();
  const thisMonthCount = claims.filter(c => {
    if (!c.created_at) return false;
    const d = new Date(c.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 26 }}>&#x1F4CA;</span> EW Dashboard
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
              Extended Warranty vehicle claims at a glance
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => router.push('/ew-vehicle-claims')}
              style={{ padding: '8px 14px', background: '#fff', border: '1px solid #7c3aed', color: '#7c3aed', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              View All Claims
            </button>
            <button
              onClick={() => router.push('/ew-vehicle-claims/mis')}
              style={{ padding: '8px 14px', background: '#fff', border: '1px solid #7c3aed', color: '#7c3aed', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Open EW MIS
            </button>
            <button
              onClick={() => router.push('/ew-vehicle-claims/register')}
              style={{ padding: '8px 14px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              + New EW Claim
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Loading EW claims...</div>
        ) : (
          <>
            {/* Top Stat Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
              <StatCard label="Total EW Claims" value={total} accent="#7c3aed" icon="&#x1F4CB;" />
              <StatCard label="Active (Open / In Progress / Assessment)" value={active} accent="#1e40af" icon="&#x1F504;" />
              <StatCard label="Completed / Closed" value={completed} accent="#166534" icon="&#x2705;" />
              <StatCard label="Registered This Month" value={thisMonthCount} accent="#be185d" icon="&#x1F4C5;" />
            </div>

            {/* Status Summary Cards */}
            <h3 style={{ fontSize: 15, color: '#334155', marginBottom: 10 }}>Status Summary</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 20 }}>
              {STATUS_LIST.map(s => {
                const sc = STATUS_COLORS[s];
                return (
                  <div
                    key={s}
                    onClick={() => router.push(`/ew-vehicle-claims?status=${encodeURIComponent(s)}`)}
                    style={{
                      padding: '14px 14px', borderRadius: 10, cursor: 'pointer',
                      background: sc.bg, color: sc.color,
                      border: `2px solid ${sc.border}`, textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{statusCounts[s]}</div>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>{s}</div>
                  </div>
                );
              })}
            </div>

            {notStartedCount > 0 && (
              <div style={{
                marginBottom: 20, padding: '12px 16px', borderRadius: 10,
                background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e',
                fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span><strong>{notStartedCount}</strong> EW claim{notStartedCount !== 1 ? 's' : ''} registered in Claim Registration need lifecycle setup</span>
                <button
                  onClick={() => router.push('/ew-vehicle-claims')}
                  style={{ padding: '6px 12px', background: '#92400e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >
                  Setup Now
                </button>
              </div>
            )}

            {/* Stage Distribution */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 }}>
                <h3 style={{ fontSize: 15, color: '#334155', margin: '0 0 14px' }}>Stage Distribution</h3>
                {Object.entries(stageCounts).map(([stage, count]) => (
                  <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', background: '#7c3aed',
                      color: '#fff', fontSize: 11, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>{stage}</div>
                    <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 6, height: 18, overflow: 'hidden', position: 'relative' }}>
                      <div style={{
                        width: `${(count / maxStage) * 100}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #a78bfa, #7c3aed)',
                        transition: 'width 0.3s',
                      }} />
                    </div>
                    <div style={{ width: 36, textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#475569' }}>{count}</div>
                  </div>
                ))}
              </div>

              {/* Recent Claims */}
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 }}>
                <h3 style={{ fontSize: 15, color: '#334155', margin: '0 0 14px' }}>Recent EW Claims</h3>
                {recent.length === 0 ? (
                  <div style={{ color: '#94a3b8', fontSize: 13, padding: 20, textAlign: 'center' }}>No recent claims</div>
                ) : recent.map(c => {
                  const sc = STATUS_COLORS[c.status] || STATUS_COLORS['Open'];
                  return (
                    <div
                      key={c.id}
                      onClick={() => !c._needs_ew_setup && router.push(`/ew-vehicle-claims/${c.id}`)}
                      style={{
                        padding: '10px 12px', borderBottom: '1px solid #f1f5f9',
                        cursor: c._needs_ew_setup ? 'default' : 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontWeight: 600, color: '#7c3aed', fontSize: 13 }}>{c.ref_number || '-'}</div>
                        <span style={{
                          padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                          background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
                        }}>{c.status}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                        {c.customer_name || '-'} &middot; {c.vehicle_reg_no || 'No Reg'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </PageLayout>
  );
}

function StatCard({ label, value, accent, icon }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderLeft: `4px solid ${accent}`,
      borderRadius: 12, padding: '16px 18px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: accent, marginTop: 6 }}>{value}</div>
        </div>
        <span style={{ fontSize: 26, opacity: 0.8 }} dangerouslySetInnerHTML={{ __html: icon }} />
      </div>
    </div>
  );
}

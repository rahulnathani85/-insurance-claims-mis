'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { LOB_LIST, LOB_COLORS, LOB_ICONS } from '@/lib/constants';
import { useCompany } from '@/lib/CompanyContext';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { company } = useCompany();

  useEffect(() => {
    loadStats();
  }, [company]);

  async function loadStats() {
    try {
      setLoading(true);
      const res = await fetch(`/api/dashboard-stats?company=${encodeURIComponent(company)}`);
      const data = await res.json();
      setStats(data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageLayout>
      <div className="main-content">
        <h2>Dashboard</h2>

        {loading ? (
          <div className="loading">Loading...</div>
        ) : stats ? (
          <>
            <div className="stats-grid">
              <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => router.push('/mis-portal')}>
                <div className="stat-label">Total Claims</div>
                <div className="stat-value">{stats.total_claims || 0}</div>
              </div>
              <div className="stat-card" style={{ borderLeftColor: '#f97316', cursor: 'pointer' }} onClick={() => router.push('/mis-portal?status=Open')}>
                <div className="stat-label">Open Claims</div>
                <div className="stat-value">{stats.open_claims || 0}</div>
              </div>
              <div className="stat-card" style={{ borderLeftColor: '#0284c7', cursor: 'pointer' }} onClick={() => router.push('/mis-portal?status=In%20Process')}>
                <div className="stat-label">In Process</div>
                <div className="stat-value">{stats.in_process_claims || 0}</div>
              </div>
              <div className="stat-card" style={{ borderLeftColor: '#16a34a', cursor: 'pointer' }} onClick={() => router.push('/mis-portal?status=Submitted')}>
                <div className="stat-label">Submitted</div>
                <div className="stat-value">{stats.submitted_claims || 0}</div>
              </div>
            </div>

            <h3 style={{ marginTop: 30, marginBottom: 20 }}>Claims by Line of Business</h3>
            <div className="stats-grid">
              {LOB_LIST.map((lob) => {
                const count = stats.lob_distribution?.find(d => d.lob === lob)?.count || 0;
                return (
                  <div key={lob} className="stat-card" style={{ cursor: 'pointer', borderLeftColor: LOB_COLORS[lob], textAlign: 'center' }}
                    onClick={() => router.push(`/claims/${encodeURIComponent(lob)}`)}>
                    <div style={{ fontSize: 28, marginBottom: 10 }}>{LOB_ICONS[lob]}</div>
                    <div className="stat-label">{lob}</div>
                    <div style={{ fontSize: 24, marginTop: 10, fontWeight: 700, color: LOB_COLORS[lob] }}>{count}</div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="alert error">Failed to load statistics</div>
        )}
      </div>
    </PageLayout>
  );
}

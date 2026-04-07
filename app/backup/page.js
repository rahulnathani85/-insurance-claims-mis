'use client';
import { useState, useEffect } from 'react';
import PageLayout from '@/components/PageLayout';

const BACKUP_TABLES = [
  { table: 'claims', label: 'Claims', icon: '📋' },
  { table: 'policies', label: 'Policies', icon: '📄' },
  { table: 'insurers', label: 'Insurers', icon: '🏢' },
  { table: 'offices', label: 'Offices', icon: '🏛️' },
  { table: 'survey_fee_bills', label: 'Survey Fee Bills', icon: '💰' },
  { table: 'gipsa_rates', label: 'GIPSA Rates', icon: '📊' },
  { table: 'counters', label: 'Counters', icon: '🔢' },
  { table: 'brokers', label: 'Brokers', icon: '🤝' },
  { table: 'claim_workflow', label: 'Claim Workflow', icon: '⚙️' },
  { table: 'claim_assignments', label: 'Claim Assignments', icon: '👤' },
  { table: 'claim_documents', label: 'Claim Documents', icon: '📁' },
  { table: 'claim_emails', label: 'Claim Emails', icon: '✉️' },
];

export default function BackupPage() {
  const [backingUp, setBackingUp] = useState(false);
  const [alert, setAlert] = useState(null);
  const [backupResult, setBackupResult] = useState(null);
  const [downloadingTable, setDownloadingTable] = useState(null);
  const [tableCounts, setTableCounts] = useState({});
  const [loadingCounts, setLoadingCounts] = useState(true);

  const showAlert = (msg, type) => {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 8000);
  };

  const runFullBackup = async () => {
    if (backingUp) return;
    setBackingUp(true);
    showAlert('Fetching all data from database...', 'info');
    try {
      const res = await fetch('/api/backup');
      const data = await res.json();
      if (data.error) { showAlert('Backup failed: ' + data.error, 'error'); setBackingUp(false); return; }
      setBackupResult(data);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MIS_Backup_${getDateStr()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showAlert(`Backup downloaded! ${data.total_records.toLocaleString('en-IN')} records from ${data.total_tables} tables.`, 'success');
    } catch (err) { showAlert('Backup failed: ' + err.message, 'error'); }
    setBackingUp(false);
  };

  const downloadTableCSV = async (tableName, tableLabel) => {
    setDownloadingTable(tableName);
    try {
      const res = await fetch(`/api/backup?format=csv&table=${tableName}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tableName}_backup_${getDateStr()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showAlert(`${tableLabel} downloaded as CSV`, 'success');
    } catch (err) { showAlert(`Failed: ` + err.message, 'error'); }
    setDownloadingTable(null);
  };

  useEffect(() => { fetchCounts(); }, []);

  const fetchCounts = async () => {
    setLoadingCounts(true);
    try {
      const res = await fetch('/api/backup');
      const data = await res.json();
      if (data.tables) {
        const counts = {};
        for (const [table, info] of Object.entries(data.tables)) { counts[table] = info.count; }
        setTableCounts(counts);
      }
    } catch {}
    setLoadingCounts(false);
  };

  function getDateStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  }

  const totalRecords = Object.values(tableCounts).reduce((sum, c) => sum + (c || 0), 0);

  return (
    <PageLayout>
      <div className="main-content">
        <h2>Data Backup</h2>
        {alert && (
          <div style={{ marginBottom: 15, padding: '10px 15px', borderRadius: 6, background: alert.type === 'success' ? '#d1fae5' : alert.type === 'error' ? '#fee2e2' : '#dbeafe', color: alert.type === 'success' ? '#065f46' : alert.type === 'error' ? '#991b1b' : '#1e40af' }}>
            {alert.msg}
          </div>
        )}
        <div style={{ display: 'flex', gap: 15, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>Direct Download (No Server Needed)</span>
          </div>
          <button className="success" style={{ padding: '10px 24px', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, opacity: backingUp ? 0.6 : 1, cursor: backingUp ? 'not-allowed' : 'pointer' }} onClick={runFullBackup} disabled={backingUp}>
            {backingUp ? (<><span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />Downloading...</>) : (<>💾 Full Backup (JSON)</>)}
          </button>
          <button className="secondary" style={{ padding: '10px 16px', fontSize: 13 }} onClick={fetchCounts}>🔄 Refresh Counts</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 25 }}>
          <div style={{ padding: 15, background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
            <div style={{ fontSize: 12, color: '#3b82f6', fontWeight: 600 }}>TOTAL RECORDS</div>
            <div style={{ fontSize: 20, marginTop: 4, fontWeight: 700 }}>{loadingCounts ? '...' : totalRecords.toLocaleString('en-IN')}</div>
          </div>
          <div style={{ padding: 15, background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
            <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>TABLES</div>
            <div style={{ fontSize: 20, marginTop: 4, fontWeight: 700 }}>{BACKUP_TABLES.length}</div>
          </div>
          <div style={{ padding: 15, background: '#fefce8', borderRadius: 8, border: '1px solid #fde68a' }}>
            <div style={{ fontSize: 12, color: '#eab308', fontWeight: 600 }}>FORMATS</div>
            <div style={{ fontSize: 13, marginTop: 4, fontWeight: 500 }}>JSON (Full) / CSV (Per Table)</div>
          </div>
        </div>
        <h3 style={{ marginBottom: 12 }}>Download by Table</h3>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 15 }}>Download individual tables as CSV files (Excel-ready)</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {BACKUP_TABLES.map(({ table, label, icon }) => (
            <div key={table} style={{ padding: '12px 16px', background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{icon} {label}</div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{loadingCounts ? 'Loading...' : `${(tableCounts[table] || 0).toLocaleString('en-IN')} records`}</div>
              </div>
              <button style={{ padding: '6px 14px', fontSize: 12, background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, cursor: downloadingTable === table ? 'not-allowed' : 'pointer', fontWeight: 500, opacity: downloadingTable === table ? 0.6 : 1 }} onClick={() => downloadTableCSV(table, label)} disabled={downloadingTable === table}>
                {downloadingTable === table ? '...' : '📥 CSV'}
              </button>
            </div>
          ))}
        </div>
        {backupResult && (
          <div style={{ marginTop: 25 }}>
            <h3 style={{ marginBottom: 12 }}>Last Backup Summary</h3>
            <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}><strong>Date:</strong> {backupResult.backup_date_formatted}</div>
              <div style={{ fontSize: 13, marginBottom: 8 }}><strong>Total Records:</strong> {backupResult.total_records.toLocaleString('en-IN')}</div>
              <div style={{ fontSize: 13 }}><strong>Tables:</strong> {backupResult.total_tables}</div>
              <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {Object.entries(backupResult.tables).map(([table, info]) => (
                  <span key={table} style={{ padding: '4px 10px', fontSize: 11, background: info.error ? '#fee2e2' : '#d1fae5', color: info.error ? '#991b1b' : '#065f46', borderRadius: 12, fontWeight: 500 }}>
                    {info.label}: {info.error ? 'Error' : `${info.count} records`}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
    }

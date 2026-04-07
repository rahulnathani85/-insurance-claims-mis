'use client';
import { useState, useEffect } from 'react';
import PageLayout from '@/components/PageLayout';
import { FILE_SERVER_URL, FILE_SERVER_KEY } from '@/lib/constants';

export default function BackupPage() {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [backingUp, setBackingUp] = useState(false);
  const [alert, setAlert] = useState(null);
  const [serverStatus, setServerStatus] = useState(null);

  const showAlert = (msg, type) => {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  };

  // Check file server health
  const checkServer = async () => {
    try {
      const res = await fetch(`${FILE_SERVER_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      setServerStatus(data.status === 'ok' ? 'online' : 'error');
    } catch {
      setServerStatus('offline');
    }
  };

  // Load existing backups
  const loadBackups = async () => {
    try {
      const res = await fetch(`${FILE_SERVER_URL}/api/backups`);
      const data = await res.json();
      setBackups(data.backups || []);
    } catch {
      setBackups([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    checkServer();
    loadBackups();
  }, []);

  // Trigger backup
  const runBackup = async () => {
    if (backingUp) return;
    setBackingUp(true);
    showAlert('Starting database backup...', 'info');

    try {
      const res = await fetch(`${FILE_SERVER_URL}/api/backup`, {
        method: 'POST',
        headers: { 'X-API-Key': FILE_SERVER_KEY, 'Content-Type': 'application/json' }
      });
      const data = await res.json();

      if (data.success) {
        showAlert(`Backup completed! ${data.totalRecords} records from ${data.totalTables} tables saved to ${data.backupFolder}`, 'success');
        loadBackups(); // Refresh list
      } else {
        showAlert(data.error || 'Backup failed', 'error');
      }
    } catch (err) {
      showAlert('Backup failed: ' + err.message + '. Make sure the file server is running on your cloud server.', 'error');
    }
    setBackingUp(false);
  };

  return (
    <PageLayout>
      <div className="main-content">
        <h2>Data Backup</h2>

        {alert && (
          <div className={`alert ${alert.type}`} style={{ marginBottom: 15, padding: '10px 15px', borderRadius: 6, background: alert.type === 'success' ? '#d1fae5' : alert.type === 'error' ? '#fee2e2' : '#dbeafe', color: alert.type === 'success' ? '#065f46' : alert.type === 'error' ? '#991b1b' : '#1e40af' }}>
            {alert.msg}
          </div>
        )}

        {/* Server Status */}
        <div style={{ display: 'flex', gap: 15, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: serverStatus === 'online' ? '#22c55e' : serverStatus === 'offline' ? '#ef4444' : '#eab308',
              display: 'inline-block'
            }} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              File Server: {serverStatus === 'online' ? 'Online' : serverStatus === 'offline' ? 'Offline' : 'Checking...'}
            </span>
          </div>

          <button
            className="success"
            style={{
              padding: '10px 24px',
              fontSize: 14,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              opacity: backingUp || serverStatus !== 'online' ? 0.6 : 1,
              cursor: backingUp || serverStatus !== 'online' ? 'not-allowed' : 'pointer'
            }}
            onClick={runBackup}
            disabled={backingUp || serverStatus !== 'online'}
          >
            {backingUp ? (
              <>
                <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                Backing up...
              </>
            ) : (
              <>💾 Backup Now</>
            )}
          </button>

          <button
            className="secondary"
            style={{ padding: '10px 16px', fontSize: 13 }}
            onClick={() => { checkServer(); loadBackups(); }}
          >
            🔄 Refresh
          </button>
        </div>

        {serverStatus === 'offline' && (
          <div style={{ padding: 20, background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', marginBottom: 20 }}>
            <h4 style={{ color: '#dc2626', marginBottom: 8 }}>File Server Not Connected</h4>
            <p style={{ fontSize: 13, color: '#666', lineHeight: 1.6 }}>
              The file server needs to be running on your cloud server for backups to work. Follow these steps:
            </p>
            <div style={{ background: '#fff', padding: 12, borderRadius: 6, marginTop: 10, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.8 }}>
              <div><strong>Step 1:</strong> cd c:\nisla\scripts\file-server</div>
              <div><strong>Step 2:</strong> npm install</div>
              <div><strong>Step 3:</strong> node server.js</div>
              <div><strong>Step 4:</strong> Set NEXT_PUBLIC_FILE_SERVER_URL in Vercel env vars to http://YOUR-SERVER-IP:4000</div>
              <div><strong>Step 5:</strong> node install-service.js (to auto-start on boot)</div>
            </div>
          </div>
        )}

        {/* Backup Info */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 25 }}>
          <div style={{ padding: 15, background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
            <div style={{ fontSize: 12, color: '#3b82f6', fontWeight: 600 }}>BACKUP LOCATION</div>
            <div style={{ fontSize: 13, marginTop: 4, fontWeight: 500 }}>D:\2026-27\Backups\</div>
          </div>
          <div style={{ padding: 15, background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
            <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>TABLES BACKED UP</div>
            <div style={{ fontSize: 13, marginTop: 4, fontWeight: 500 }}>Claims, Policies, Insurers, Offices, Survey Fee Bills, GIPSA Rates, Counters</div>
          </div>
          <div style={{ padding: 15, background: '#fefce8', borderRadius: 8, border: '1px solid #fde68a' }}>
            <div style={{ fontSize: 12, color: '#eab308', fontWeight: 600 }}>FORMAT</div>
            <div style={{ fontSize: 13, marginTop: 4, fontWeight: 500 }}>JSON + CSV (Excel-ready)</div>
          </div>
        </div>

        {/* Backup History */}
        <h3 style={{ marginBottom: 12 }}>Backup History</h3>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>Loading backup history...</div>
        ) : backups.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999', background: '#f8fafc', borderRadius: 8 }}>
            <p style={{ fontSize: 32, marginBottom: 8 }}>💾</p>
            <p>No backups found. Click "Backup Now" to create your first backup.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Backup Name</th>
                  <th>Date & Time</th>
                  <th>Records</th>
                  <th>Tables</th>
                  <th>Files</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500, fontSize: 13 }}>{b.name}</td>
                    <td style={{ fontSize: 13 }}>{b.dateFormatted}</td>
                    <td style={{ fontSize: 13 }}>{b.totalRecords.toLocaleString('en-IN')}</td>
                    <td style={{ fontSize: 13 }}>{b.totalTables}</td>
                    <td style={{ fontSize: 13 }}>{b.fileCount}</td>
                    <td>
                      <button
                        className="secondary"
                        style={{ fontSize: 11, padding: '4px 10px' }}
                        onClick={() => window.open(`${FILE_SERVER_URL}${b.browseUrl}`, '_blank')}
                      >
                        📁 Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageLayout>
  );
}

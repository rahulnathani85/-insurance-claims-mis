'use client';
import { useState, useEffect } from 'react';
import PageLayout from '@/components/PageLayout';
import { LOB_LIST } from '@/lib/constants';

export default function RefNumberPortal() {
  const [refNumbers, setRefNumbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [filterLob, setFilterLob] = useState('');

  useEffect(() => {
    loadRefNumbers();
  }, [filterLob]);

  async function loadRefNumbers() {
    try {
      setLoading(true);
      let url = '/api/ref-numbers';
      if (filterLob) url += `?lob=${encodeURIComponent(filterLob)}`;
      const data = await fetch(url).then(r => r.json());
      setRefNumbers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load ref numbers:', error);
      setRefNumbers([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}
        <h2>Reference Number Portal</h2>
        <p style={{ color: '#666', fontSize: 13, marginBottom: 15 }}>
          Reference number counters are managed automatically. This page shows the current status of all counters.
        </p>

        <div className="button-group">
          <button className="secondary" onClick={loadRefNumbers}>Refresh</button>
        </div>

        <div className="filter-section">
          <select value={filterLob} onChange={e => setFilterLob(e.target.value)}>
            <option value="">All LOBs</option>
            {LOB_LIST.map(lob => <option key={lob} value={lob}>{lob}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="loading">Loading reference number structures...</div>
        ) : refNumbers.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>No reference number structures found</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>LOB</th>
                <th>Format</th>
                <th>Start Number</th>
                <th>Current Counter</th>
                <th>Next Ref Number</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {refNumbers.map(rn => {
                const next = rn.current_number + 1;
                let nextRef = '';
                if (rn.format.includes('Marine')) {
                  nextRef = `${next}/26-27/Marine`;
                } else if (rn.format.includes('{counter:04d}')) {
                  nextRef = rn.format.replace('{counter:04d}', String(next).padStart(4, '0')).replace('YY-YY', '26-27');
                } else if (rn.format.includes('{counter:03d}')) {
                  nextRef = rn.format.replace('{counter:03d}', String(next).padStart(3, '0')).replace('YY-YY', '26-27');
                } else {
                  nextRef = rn.format.replace('{counter}', next).replace('YY-YY', '26-27').replace('{LOB}', rn.lob);
                }
                return (
                  <tr key={rn.id}>
                    <td>{rn.lob}</td>
                    <td><code style={{ backgroundColor: '#f3f4f6', padding: '2px 6px', borderRadius: '3px', fontSize: 12 }}>{rn.format}</code></td>
                    <td>{rn.start_number}</td>
                    <td><strong>{rn.current_number}</strong></td>
                    <td style={{ color: '#2563eb', fontWeight: 500 }}>{nextRef}</td>
                    <td style={{ fontSize: 12, color: '#666' }}>{rn.description || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </PageLayout>
  );
}

'use client';
import { useState, useEffect } from 'react';
import PageLayout from '@/components/PageLayout';
import { useCompany } from '@/lib/CompanyContext';

const STAGES = [
  { key: 'Intimation', icon: '📩', color: '#3b82f6' },
  { key: 'Survey Scheduled', icon: '📅', color: '#8b5cf6' },
  { key: 'Survey Done', icon: '✅', color: '#10b981' },
  { key: 'Assessment', icon: '📊', color: '#f59e0b' },
  { key: 'Report Drafted', icon: '📝', color: '#6366f1' },
  { key: 'Report Submitted', icon: '📤', color: '#0891b2' },
  { key: 'Settled', icon: '💰', color: '#16a34a' },
  { key: 'Closed', icon: '🔒', color: '#6b7280' },
];

const DOC_TYPES = [
  'Appointment Letter', 'Claim Form', 'Policy Copy', 'Survey Photos',
  'LOR', 'ILA', 'FSR', 'Survey Fee Bill', 'Other'
];

export default function FileTrackingPage() {
  return (
    <PageLayout>
      <FileTrackingContent />
    </PageLayout>
  );
}

function FileTrackingContent() {
  const { company } = useCompany();
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedClaim, setSelectedClaim] = useState(null);
  const [stages, setStages] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [showStageModal, setShowStageModal] = useState(false);
  const [showDocModal, setShowDocModal] = useState(false);
  const [newStage, setNewStage] = useState({ stage: '', stage_date: '', notes: '' });
  const [newDoc, setNewDoc] = useState({ document_type: '', document_name: '', status: 'Pending', remarks: '' });
  const [alert, setAlert] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchClaims();
  }, [company]);

  const fetchClaims = async () => {
    setLoading(true);
    const res = await fetch(`/api/claims?company=${company}`);
    const data = await res.json();
    setClaims(data);
    setLoading(false);
  };

  const selectClaim = async (claim) => {
    setSelectedClaim(claim);
    const [stagesRes, docsRes] = await Promise.all([
      fetch(`/api/claim-stages?claim_id=${claim.id}`),
      fetch(`/api/claim-documents?claim_id=${claim.id}`),
    ]);
    setStages(await stagesRes.json());
    setDocuments(await docsRes.json());
  };

  const addStage = async () => {
    if (!newStage.stage) return;
    const res = await fetch('/api/claim-stages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newStage, claim_id: selectedClaim.id }),
    });
    if (res.ok) {
      const data = await res.json();
      setStages([...stages, data]);
      setShowStageModal(false);
      setNewStage({ stage: '', stage_date: '', notes: '' });
      setAlert({ type: 'success', message: 'Stage added successfully' });
      setTimeout(() => setAlert(null), 3000);
    }
  };

  const addDocument = async () => {
    if (!newDoc.document_type) return;
    const res = await fetch('/api/claim-documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newDoc, claim_id: selectedClaim.id }),
    });
    if (res.ok) {
      const data = await res.json();
      setDocuments([data, ...documents]);
      setShowDocModal(false);
      setNewDoc({ document_type: '', document_name: '', status: 'Pending', remarks: '' });
      setAlert({ type: 'success', message: 'Document tracked successfully' });
      setTimeout(() => setAlert(null), 3000);
    }
  };

  const getCurrentStage = (claimId) => {
    if (selectedClaim?.id === claimId && stages.length > 0) {
      return stages[stages.length - 1].stage;
    }
    return null;
  };

  const filteredClaims = claims.filter(c => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (c.ref_number || '').toLowerCase().includes(s) ||
      (c.insured_name || '').toLowerCase().includes(s) ||
      (c.insurer_name || '').toLowerCase().includes(s) ||
      (c.claim_number || '').toLowerCase().includes(s);
  });

  return (
    <div>
      <h2 style={{ marginBottom: 20 }}>File Tracking & Status</h2>

      {alert && (
        <div style={{ padding: '10px 15px', borderRadius: 8, marginBottom: 15, background: alert.type === 'success' ? '#dcfce7' : '#fef2f2', color: alert.type === 'success' ? '#16a34a' : '#dc2626', border: `1px solid ${alert.type === 'success' ? '#bbf7d0' : '#fecaca'}` }}>
          {alert.message}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selectedClaim ? '1fr 1fr' : '1fr', gap: 20 }}>
        {/* Claims List */}
        <div>
          <div style={{ marginBottom: 15 }}>
            <input
              type="text"
              placeholder="Search by ref number, insured, insurer, claim number..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
            />
          </div>

          {loading ? <p>Loading claims...</p> : (
            <div style={{ maxHeight: '70vh', overflow: 'auto' }}>
              <table className="data-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Ref No</th>
                    <th>LOB</th>
                    <th>Insured</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClaims.map(c => (
                    <tr key={c.id} style={{ background: selectedClaim?.id === c.id ? '#eff6ff' : 'transparent', cursor: 'pointer' }} onClick={() => selectClaim(c)}>
                      <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{c.ref_number || '-'}</td>
                      <td>{c.lob || '-'}</td>
                      <td>{c.insured_name || '-'}</td>
                      <td><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: c.status === 'Open' ? '#fef3c7' : c.status === 'Submitted' ? '#dcfce7' : '#dbeafe', color: c.status === 'Open' ? '#92400e' : c.status === 'Submitted' ? '#15803d' : '#1e40af' }}>{c.status}</span></td>
                      <td><button className="secondary" style={{ fontSize: 10, padding: '3px 8px' }} onClick={(e) => { e.stopPropagation(); selectClaim(c); }}>Track</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Tracking Panel */}
        {selectedClaim && (
          <div style={{ background: '#f8fafc', borderRadius: 12, padding: 20, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>{selectedClaim.ref_number}</h3>
              <button className="secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setSelectedClaim(null)}>Close</button>
            </div>
            <p style={{ fontSize: 12, color: '#666', margin: '0 0 5px' }}>{selectedClaim.insured_name} | {selectedClaim.lob}</p>
            <p style={{ fontSize: 12, color: '#666', margin: '0 0 20px' }}>{selectedClaim.insurer_name}</p>

            {/* Lifecycle Timeline */}
            <div style={{ marginBottom: 25 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h4 style={{ margin: 0, fontSize: 14 }}>Claim Lifecycle</h4>
                <button style={{ fontSize: 11, padding: '4px 12px', background: '#1e3a5f', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }} onClick={() => setShowStageModal(true)}>+ Add Stage</button>
              </div>

              <div style={{ position: 'relative', paddingLeft: 20 }}>
                {/* Stage line */}
                {stages.length > 0 && <div style={{ position: 'absolute', left: 8, top: 8, bottom: 8, width: 2, background: '#cbd5e1' }} />}
                {stages.map((s, i) => {
                  const stageInfo = STAGES.find(st => st.key === s.stage) || { icon: '📌', color: '#6b7280' };
                  return (
                    <div key={s.id} style={{ display: 'flex', gap: 10, marginBottom: 12, position: 'relative' }}>
                      <div style={{ width: 18, height: 18, borderRadius: '50%', background: stageInfo.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, position: 'absolute', left: -12, zIndex: 1 }}>
                        {stageInfo.icon}
                      </div>
                      <div style={{ marginLeft: 15 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{s.stage}</div>
                        <div style={{ fontSize: 11, color: '#666' }}>{s.stage_date || ''} {s.notes ? `- ${s.notes}` : ''}</div>
                      </div>
                    </div>
                  );
                })}
                {stages.length === 0 && <p style={{ fontSize: 12, color: '#999' }}>No stages tracked yet. Click "+ Add Stage" to begin.</p>}
              </div>
            </div>

            {/* Document Checklist */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h4 style={{ margin: 0, fontSize: 14 }}>Document Tracker</h4>
                <button style={{ fontSize: 11, padding: '4px 12px', background: '#1e3a5f', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }} onClick={() => setShowDocModal(true)}>+ Track Doc</button>
              </div>

              {documents.length > 0 ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {documents.map(d => (
                    <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{d.document_type}</div>
                        {d.document_name !== d.document_type && <div style={{ fontSize: 11, color: '#666' }}>{d.document_name}</div>}
                      </div>
                      <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: d.status === 'Generated' ? '#dcfce7' : d.status === 'Uploaded' ? '#dbeafe' : d.status === 'Sent' ? '#f0fdf4' : '#fef3c7', color: d.status === 'Generated' ? '#15803d' : d.status === 'Uploaded' ? '#1e40af' : d.status === 'Sent' ? '#166534' : '#92400e' }}>{d.status}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 12, color: '#999' }}>No documents tracked. Click "+ Track Doc" to add.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add Stage Modal */}
      {showStageModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 25, width: 400, maxHeight: '80vh', overflow: 'auto' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: 16 }}>Add Claim Stage</h3>
            <div style={{ marginBottom: 15 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Stage</label>
              <select value={newStage.stage} onChange={e => setNewStage({ ...newStage, stage: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}>
                <option value="">Select Stage</option>
                {STAGES.map(s => <option key={s.key} value={s.key}>{s.icon} {s.key}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 15 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Date</label>
              <input type="date" value={newStage.stage_date} onChange={e => setNewStage({ ...newStage, stage_date: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Notes</label>
              <textarea value={newStage.notes} onChange={e => setNewStage({ ...newStage, notes: e.target.value })} rows={3} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} placeholder="Optional notes..." />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="secondary" onClick={() => setShowStageModal(false)} style={{ padding: '8px 16px', fontSize: 13 }}>Cancel</button>
              <button onClick={addStage} style={{ padding: '8px 16px', fontSize: 13, background: '#1e3a5f', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Add Stage</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Document Modal */}
      {showDocModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 25, width: 400, maxHeight: '80vh', overflow: 'auto' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: 16 }}>Track Document</h3>
            <div style={{ marginBottom: 15 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Document Type</label>
              <select value={newDoc.document_type} onChange={e => setNewDoc({ ...newDoc, document_type: e.target.value, document_name: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}>
                <option value="">Select Type</option>
                {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 15 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Document Name</label>
              <input type="text" value={newDoc.document_name} onChange={e => setNewDoc({ ...newDoc, document_name: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 15 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Status</label>
              <select value={newDoc.status} onChange={e => setNewDoc({ ...newDoc, status: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}>
                <option value="Pending">Pending</option>
                <option value="Generated">Generated</option>
                <option value="Uploaded">Uploaded</option>
                <option value="Sent">Sent</option>
              </select>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Remarks</label>
              <textarea value={newDoc.remarks} onChange={e => setNewDoc({ ...newDoc, remarks: e.target.value })} rows={2} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} placeholder="Optional remarks..." />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="secondary" onClick={() => setShowDocModal(false)} style={{ padding: '8px 16px', fontSize: 13 }}>Cancel</button>
              <button onClick={addDocument} style={{ padding: '8px 16px', fontSize: 13, background: '#1e3a5f', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Track Document</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';
import { useState, useEffect } from 'react';
import PageLayout from '@/components/PageLayout';
import { useCompany } from '@/lib/CompanyContext';
import { LOB_LIST } from '@/lib/constants';

export default function SurveyFeeBill() {
  const { company } = useCompany();
  const [bills, setBills] = useState([]);
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showCalcModal, setShowCalcModal] = useState(false);
  const [formData, setFormData] = useState({});
  const [calcResult, setCalcResult] = useState(null);
  const [alert, setAlert] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  useEffect(() => { loadAll(); }, [company]);

  async function loadAll() {
    try {
      setLoading(true);
      const [b, c] = await Promise.all([
        fetch(`/api/survey-fee-bills?company=${encodeURIComponent(company)}`).then(r => r.json()),
        fetch(`/api/claims?company=${encodeURIComponent(company)}`).then(r => r.json()),
      ]);
      setBills(Array.isArray(b) ? b : []);
      setClaims(Array.isArray(c) ? c : []);
    } catch (e) {
      console.error('Load error:', e);
    } finally {
      setLoading(false);
    }
  }

  function showAlertMsg(msg, type) {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  // Quick GIPSA calculator (client-side preview)
  function calculatePreview(lob, amount) {
    const a = parseFloat(amount) || 0;
    if (a <= 0) return { fee: 0, gst: 0, total: 0 };

    let fee = 0;
    const standardCalc = (a) => {
      if (a <= 100000) return 5000;
      if (a <= 500000) return a * 0.05;
      if (a <= 1000000) return 25000 + (a - 500000) * 0.03;
      if (a <= 5000000) return 40000 + (a - 1000000) * 0.02;
      if (a <= 10000000) return 120000 + (a - 5000000) * 0.015;
      return 195000 + (a - 10000000) * 0.01;
    };
    const marineCalc = (a) => {
      if (a <= 100000) return 3500;
      if (a <= 500000) return a * 0.04;
      if (a <= 1000000) return 20000 + (a - 500000) * 0.025;
      if (a <= 5000000) return 32500 + (a - 1000000) * 0.015;
      return 92500 + (a - 5000000) * 0.01;
    };
    const ewCalc = (a) => {
      if (a <= 50000) return 2500;
      if (a <= 200000) return a * 0.04;
      if (a <= 500000) return 8000 + (a - 200000) * 0.03;
      return 17000 + (a - 500000) * 0.02;
    };
    const bankCalc = (a) => {
      if (a <= 100000) return 3500;
      if (a <= 500000) return a * 0.04;
      return 20000 + (a - 500000) * 0.02;
    };
    const miscCalc = (a) => {
      if (a <= 100000) return 5000;
      if (a <= 500000) return a * 0.05;
      if (a <= 1000000) return 25000 + (a - 500000) * 0.03;
      return 40000 + (a - 1000000) * 0.02;
    };

    switch (lob) {
      case 'Marine Cargo': fee = marineCalc(a); break;
      case 'Extended Warranty': fee = ewCalc(a); break;
      case 'Banking': fee = bankCalc(a); break;
      case 'Miscellaneous': case 'Liability': case 'Marine Hull': fee = miscCalc(a); break;
      default: fee = standardCalc(a);
    }

    fee = Math.round(fee * 100) / 100;
    const gst = Math.round(fee * 0.18 * 100) / 100;
    return { fee, gst, total: fee + gst };
  }

  function openCalculator() {
    setCalcResult(null);
    setShowCalcModal(true);
  }

  function handleClaimSelect(claimId) {
    const claim = claims.find(c => c.id === parseInt(claimId));
    if (claim) {
      setFormData(prev => ({
        ...prev,
        claim_id: claim.id,
        ref_number: claim.ref_number,
        lob: claim.lob,
        insured_name: claim.insured_name,
        insurer_name: claim.insurer_name,
        loss_amount: claim.assessed_loss || claim.gross_loss || '',
      }));
    }
  }

  function openNewBill() {
    setFormData({ fee_type: 'GIPSA', gst_rate: 18, bill_date: new Date().toISOString().split('T')[0] });
    setShowModal(true);
  }

  async function saveBill() {
    if (!formData.lob || !formData.loss_amount) {
      showAlertMsg('LOB and Loss Amount are required', 'error');
      return;
    }
    try {
      const res = await fetch('/api/survey-fee-bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, company })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed');
      }
      const result = await res.json();
      showAlertMsg(`Bill generated! Number: ${result.bill_number} | Total: ₹${result.total_amount?.toLocaleString('en-IN')}`, 'success');
      setShowModal(false);
      await loadAll();
    } catch (e) {
      showAlertMsg('Failed: ' + e.message, 'error');
    }
  }

  const filteredBills = bills.filter(b => {
    const matchSearch = !searchTerm || b.bill_number?.toLowerCase().includes(searchTerm.toLowerCase()) || b.insured_name?.toLowerCase().includes(searchTerm.toLowerCase()) || b.ref_number?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = !filterStatus || b.payment_status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}
        <h2>Survey Fee Bill Portal</h2>

        <div className="button-group">
          <button className="success" onClick={openNewBill}>+ Generate New Bill</button>
          <button className="secondary" onClick={openCalculator}>🧮 Fee Calculator</button>
        </div>

        <div className="filter-section">
          <div className="filter-row">
            <input placeholder="Search by bill number, insured name, or ref number" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All Payment Status</option>
              <option value="Pending">Pending</option>
              <option value="Paid">Paid</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="loading">Loading bills...</div>
        ) : filteredBills.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>No survey fee bills found</p>
        ) : (
          <div className="mis-table-container">
            <table className="mis-table">
              <thead>
                <tr>
                  <th>Bill Number</th>
                  <th>Bill Date</th>
                  <th>Ref Number</th>
                  <th>LOB</th>
                  <th>Insured Name</th>
                  <th>Loss Amount</th>
                  <th>Fee</th>
                  <th>GST</th>
                  <th>Total</th>
                  <th>Type</th>
                  <th>Payment</th>
                </tr>
              </thead>
              <tbody>
                {filteredBills.map(b => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 500 }}>{b.bill_number}</td>
                    <td>{b.bill_date || '-'}</td>
                    <td>{b.ref_number || '-'}</td>
                    <td>{b.lob || '-'}</td>
                    <td>{b.insured_name || '-'}</td>
                    <td>{b.loss_amount ? `₹${parseFloat(b.loss_amount).toLocaleString('en-IN')}` : '-'}</td>
                    <td>{b.calculated_fee ? `₹${parseFloat(b.calculated_fee).toLocaleString('en-IN')}` : '-'}</td>
                    <td>{b.gst_amount ? `₹${parseFloat(b.gst_amount).toLocaleString('en-IN')}` : '-'}</td>
                    <td style={{ fontWeight: 600 }}>{b.total_amount ? `₹${parseFloat(b.total_amount).toLocaleString('en-IN')}` : '-'}</td>
                    <td><span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: b.fee_type === 'Custom' ? '#fef3c7' : '#dbeafe', color: b.fee_type === 'Custom' ? '#92400e' : '#1e40af' }}>{b.fee_type}</span></td>
                    <td><span className={`badge ${b.payment_status === 'Paid' ? 'submitted' : 'open'}`}>{b.payment_status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ marginTop: 10, color: '#666', fontSize: 12 }}>Total Bills: {filteredBills.length}</p>
      </div>

      {/* Generate Bill Modal */}
      {showModal && (
        <div className="modal show" onClick={e => e.target.className.includes('modal show') && setShowModal(false)}>
          <div className="modal-content wide">
            <span className="modal-close" onClick={() => setShowModal(false)}>&times;</span>
            <h3>Generate Survey Fee Bill</h3>

            <div className="form-section">
              <h4>Link to Claim (Optional)</h4>
              <div className="form-group">
                <label>Select Claim</label>
                <select value={formData.claim_id || ''} onChange={e => handleClaimSelect(e.target.value)}>
                  <option value="">-- Select Claim (auto-fills details) --</option>
                  {claims.filter(c => c.status !== 'Submitted').map(c => (
                    <option key={c.id} value={c.id}>{c.ref_number} - {c.insured_name} ({c.lob})</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-section">
              <h4>Bill Details</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Bill Date *</label>
                  <input type="date" value={formData.bill_date || ''} onChange={e => setFormData({ ...formData, bill_date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Ref Number</label>
                  <input value={formData.ref_number || ''} onChange={e => setFormData({ ...formData, ref_number: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>LOB *</label>
                  <select value={formData.lob || ''} onChange={e => setFormData({ ...formData, lob: e.target.value })}>
                    <option value="">-- Select LOB --</option>
                    {LOB_LIST.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Fee Type</label>
                  <select value={formData.fee_type || 'GIPSA'} onChange={e => setFormData({ ...formData, fee_type: e.target.value })}>
                    <option value="GIPSA">GIPSA Schedule</option>
                    <option value="Custom">Custom Rate</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Insured Name</label>
                  <input value={formData.insured_name || ''} onChange={e => setFormData({ ...formData, insured_name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Insurer</label>
                  <input value={formData.insurer_name || ''} onChange={e => setFormData({ ...formData, insurer_name: e.target.value })} />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h4>Fee Calculation</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Loss / Assessed Amount *</label>
                  <input type="number" step="0.01" value={formData.loss_amount || ''} onChange={e => setFormData({ ...formData, loss_amount: e.target.value })} />
                </div>
                {formData.fee_type === 'Custom' && (
                  <div className="form-group">
                    <label>Custom Fee Amount</label>
                    <input type="number" step="0.01" value={formData.calculated_fee || ''} onChange={e => setFormData({ ...formData, calculated_fee: e.target.value })} />
                  </div>
                )}
                <div className="form-group">
                  <label>GST Rate (%)</label>
                  <input type="number" value={formData.gst_rate || 18} onChange={e => setFormData({ ...formData, gst_rate: e.target.value })} />
                </div>
              </div>

              {formData.lob && formData.loss_amount && formData.fee_type !== 'Custom' && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 15, marginTop: 10 }}>
                  <h4 style={{ color: '#166534', marginBottom: 8 }}>GIPSA Fee Preview</h4>
                  {(() => {
                    const preview = calculatePreview(formData.lob, formData.loss_amount);
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                        <div><span style={{ fontSize: 12, color: '#666' }}>Survey Fee:</span><br /><strong>₹{preview.fee.toLocaleString('en-IN')}</strong></div>
                        <div><span style={{ fontSize: 12, color: '#666' }}>GST (18%):</span><br /><strong>₹{preview.gst.toLocaleString('en-IN')}</strong></div>
                        <div><span style={{ fontSize: 12, color: '#666' }}>Total:</span><br /><strong style={{ color: '#166534', fontSize: 18 }}>₹{preview.total.toLocaleString('en-IN')}</strong></div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            <div className="form-group">
              <label>Remarks</label>
              <textarea value={formData.remarks || ''} onChange={e => setFormData({ ...formData, remarks: e.target.value })} rows={2} />
            </div>

            <div style={{ marginTop: 20 }}>
              <button className="success" style={{ width: '100%' }} onClick={saveBill}>Generate Bill</button>
              <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Calculator Modal */}
      {showCalcModal && (
        <div className="modal show" onClick={e => e.target.className.includes('modal show') && setShowCalcModal(false)}>
          <div className="modal-content">
            <span className="modal-close" onClick={() => setShowCalcModal(false)}>&times;</span>
            <h3>🧮 GIPSA Fee Calculator</h3>
            <p style={{ color: '#666', fontSize: 13, marginBottom: 15 }}>Quick calculation tool - does not generate a bill</p>

            <div className="form-group">
              <label>Line of Business</label>
              <select id="calc-lob" onChange={e => {
                const lob = e.target.value;
                const amt = document.getElementById('calc-amount')?.value;
                if (lob && amt) setCalcResult(calculatePreview(lob, amt));
              }}>
                <option value="">-- Select LOB --</option>
                {LOB_LIST.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Loss / Assessed Amount (₹)</label>
              <input type="number" id="calc-amount" step="0.01" placeholder="Enter amount" onChange={e => {
                const lob = document.getElementById('calc-lob')?.value;
                if (lob && e.target.value) setCalcResult(calculatePreview(lob, e.target.value));
              }} />
            </div>

            {calcResult && (
              <div style={{ background: '#f0fdf4', border: '2px solid #22c55e', borderRadius: 10, padding: 20, marginTop: 15 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: '#666' }}>Survey Fee</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#1e3a5f' }}>₹{calcResult.fee.toLocaleString('en-IN')}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: '#666' }}>GST (18%)</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#1e3a5f' }}>₹{calcResult.gst.toLocaleString('en-IN')}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'center', marginTop: 15, paddingTop: 15, borderTop: '2px solid #bbf7d0' }}>
                  <div style={{ fontSize: 12, color: '#666' }}>Total Payable</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#166534' }}>₹{calcResult.total.toLocaleString('en-IN')}</div>
                </div>
              </div>
            )}

            <button className="secondary" style={{ width: '100%', marginTop: 20 }} onClick={() => setShowCalcModal(false)}>Close</button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

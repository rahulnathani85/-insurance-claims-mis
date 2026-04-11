'use client';
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';
import { downloadAsPDF, downloadAsWord } from '@/lib/documentExport';

const EW_STAGES = [
  { number: 1, name: 'Claim Intimation', short: 'Intimation' },
  { number: 2, name: 'Claim Registration', short: 'Registration' },
  { number: 3, name: 'Contact Dealer', short: 'Dealer' },
  { number: 4, name: 'Initial Inspection', short: 'Inspection' },
  { number: 5, name: 'Document Analysis', short: 'Documents' },
  { number: 6, name: 'Initial Observation Shared', short: 'Observation' },
  { number: 7, name: 'Dismantled Inspection', short: 'Dismantled' },
  { number: 8, name: 'Estimate Approved', short: 'Estimate' },
  { number: 9, name: 'Reinspection', short: 'Reinspect' },
  { number: 10, name: 'Tax Invoice Collected', short: 'Invoice' },
  { number: 11, name: 'Assessment Done', short: 'Assessment' },
  { number: 12, name: 'FSR Prepared', short: 'FSR' },
];

const STAGE_STATUS_COLORS = {
  'Pending': { bg: '#f1f5f9', color: '#64748b', ring: '#cbd5e1' },
  'In Progress': { bg: '#fef3c7', color: '#92400e', ring: '#f59e0b' },
  'Completed': { bg: '#dcfce7', color: '#166534', ring: '#22c55e' },
  'Skipped': { bg: '#f1f5f9', color: '#94a3b8', ring: '#94a3b8' },
};

const DATA_TABS = [
  { key: 'claim', label: 'Claim Details' },
  { key: 'vehicle', label: 'Vehicle / Certificate' },
  { key: 'survey', label: 'Survey & Findings' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'conclusion', label: 'Conclusion' },
  { key: 'media', label: 'Photos / Videos' },
];

const FIELD_STYLE = {
  width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6,
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
};
const LABEL_STYLE = { display: 'block', fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 3 };

// Field component OUTSIDE the page component to prevent re-mount on every keystroke
function F({ label, field, type, span, textarea, rows, editForm, updateEditForm }) {
  const wrapStyle = span ? { gridColumn: `span ${span}` } : {};
  return (
    <div style={wrapStyle}>
      <label style={LABEL_STYLE}>{label}</label>
      {textarea ? (
        <textarea
          value={editForm[field] || ''}
          onChange={e => updateEditForm({ [field]: e.target.value })}
          style={{ ...FIELD_STYLE, minHeight: rows ? rows * 22 : 60, resize: 'vertical' }}
        />
      ) : (
        <input
          type={type || 'text'}
          value={editForm[field] || ''}
          onChange={e => updateEditForm({ [field]: e.target.value })}
          style={FIELD_STYLE}
        />
      )}
    </div>
  );
}

export default function EWClaimDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { company } = useCompany();
  const { user } = useAuth();

  const [claim, setClaim] = useState(null);
  const [stages, setStages] = useState([]);
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('claim');
  const [alert, setAlert] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [stageNotes, setStageNotes] = useState({});
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [generatingFSR, setGeneratingFSR] = useState(false);
  const [mediaStageFilter, setMediaStageFilter] = useState('all');
  const fileInputRef = useRef(null);

  // Master data for auto-fetch
  const [policies, setPolicies] = useState([]);
  const [insurers, setInsurers] = useState([]);
  const [fetchingPolicy, setFetchingPolicy] = useState(false);
  const [fetchingInsurer, setFetchingInsurer] = useState(false);

  useEffect(() => { if (id) loadAll(); }, [id]);

  // Load master data for auto-fill
  useEffect(() => {
    if (company) {
      fetch(`/api/policies?company=${encodeURIComponent(company)}`)
        .then(r => r.json()).then(d => setPolicies(Array.isArray(d) ? d : [])).catch(() => {});
      fetch('/api/insurers')
        .then(r => r.json()).then(d => setInsurers(Array.isArray(d) ? d : [])).catch(() => {});
    }
  }, [company]);

  // Shared fields that live in both claims and ew_vehicle_claims
  // (date_intimation <-> date_of_intimation is handled separately)
  const SHARED_FIELDS = [
    'insured_name',
    'insurer_name',
    'insured_address',
    'insurer_address',
    'policy_number',
    'claim_file_no',
    'person_contacted',
    'estimated_loss_amount',
  ];

  // Standard opener surveyors use for every initial observation entry
  // so that the paragraph in the FSR starts consistently.
  const DEFAULT_INITIAL_OBSERVATION = 'During our survey, it was noted that ';

  // Standard conclusion paragraph. The surrounding Note: bullets,
  // without-prejudice disclaimer and signatory block already live in
  // the FSR HTML template — this field is only the main paragraph that
  // sits under the "5. CONCLUSION:" heading so the surveyor can tweak
  // it per claim if needed.
  const DEFAULT_CONCLUSION_TEXT = 'In view of the above, as per the Manufacturer Guidelines / Manual, the defective / part has been replaced with new one, same be considered under extended warranty, subject to coverage of the vehicle in the policy and as per the terms and conditions of the policy issued.';

  async function loadAll() {
    try {
      setLoading(true);
      const [claimRes, stagesRes, mediaRes] = await Promise.all([
        fetch(`/api/ew-claims?id=${id}`).then(r => r.json()),
        fetch(`/api/ew-claim-stages?ew_claim_id=${id}`).then(r => r.json()),
        fetch(`/api/ew-claim-media?ew_claim_id=${id}`).then(r => r.json()),
      ]);

      let merged = claimRes || {};

      // If this EW claim is linked to a row in the main claims table,
      // fetch it and pull shared fields across so the form pre-populates
      // with whatever was entered at Claim Registration time.
      if (claimRes && claimRes.claim_id) {
        try {
          const parentClaim = await fetch(`/api/claims/${claimRes.claim_id}`).then(r => r.json());
          if (parentClaim && !parentClaim.error) {
            const enriched = { ...merged };
            SHARED_FIELDS.forEach(f => {
              // Parent claim value wins when the EW row is blank, otherwise
              // keep whatever is already on the EW row (avoid overwriting
              // data that was edited via the EW detail page).
              if ((enriched[f] === undefined || enriched[f] === null || enriched[f] === '') && parentClaim[f] !== undefined && parentClaim[f] !== null && parentClaim[f] !== '') {
                enriched[f] = parentClaim[f];
              }
            });
            // Map date_intimation (claims) -> date_of_intimation (ew)
            if ((enriched.date_of_intimation === undefined || enriched.date_of_intimation === null || enriched.date_of_intimation === '') && parentClaim.date_intimation) {
              enriched.date_of_intimation = parentClaim.date_intimation;
            }
            merged = enriched;
          }
        } catch (fetchErr) {
          // Non-fatal - fall back to EW row values
          console.warn('Could not fetch parent claim for auto-populate:', fetchErr);
        }
      }

      // Prefill survey / conclusion defaults if the surveyor hasn't
      // written anything yet. Only fills blanks, never overwrites.
      if (!merged.initial_observation || !merged.initial_observation.trim()) {
        merged.initial_observation = DEFAULT_INITIAL_OBSERVATION;
      }
      if (!merged.conclusion_text || !merged.conclusion_text.trim()) {
        merged.conclusion_text = DEFAULT_CONCLUSION_TEXT;
      }

      setClaim(merged);
      setEditForm(merged);
      setStages(Array.isArray(stagesRes) ? stagesRes : []);
      setMedia(Array.isArray(mediaRes) ? mediaRes : []);
      // Initialize stage notes
      const notes = {};
      (Array.isArray(stagesRes) ? stagesRes : []).forEach(s => { notes[s.stage_number] = s.notes || ''; });
      setStageNotes(notes);
    } catch (e) {
      console.error('Failed to load EW claim:', e);
    } finally {
      setLoading(false);
    }
  }

  function showAlert(msg, type = 'success') {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  function updateEditForm(updates) {
    setEditForm(prev => ({ ...prev, ...updates }));
  }

  // Auto-fetch insured address from Policy Master
  function fetchFromPolicyMaster() {
    const policyNum = (editForm.policy_number || '').trim();
    if (!policyNum) { showAlert('Enter a policy number first', 'error'); return; }
    setFetchingPolicy(true);
    const match = policies.find(p =>
      (p.policy_number || '').trim().toLowerCase() === policyNum.toLowerCase()
    );
    if (match) {
      const updates = {};
      if (match.insured_address) updates.insured_address = match.insured_address;
      if (match.insured_name && !editForm.insured_name) updates.insured_name = match.insured_name;
      if (Object.keys(updates).length > 0) {
        updateEditForm(updates);
        showAlert('Insured address fetched from Policy Master');
      } else {
        showAlert('Policy found but no address on record', 'error');
      }
    } else {
      showAlert('Policy number not found in Policy Master', 'error');
    }
    setFetchingPolicy(false);
  }

  // Auto-fetch insurer address from Insurer Master
  function fetchFromInsurerMaster() {
    const insurerName = (editForm.insurer_name || '').trim();
    if (!insurerName) { showAlert('Enter an insurer name first', 'error'); return; }
    setFetchingInsurer(true);
    const match = insurers.find(ins =>
      (ins.company_name || '').trim().toLowerCase().includes(insurerName.toLowerCase()) ||
      insurerName.toLowerCase().includes((ins.company_name || '').trim().toLowerCase())
    );
    if (match) {
      // Build full address from insurer master fields
      const parts = [match.registered_address, match.city, match.state, match.pin].filter(Boolean);
      const fullAddress = parts.join(', ');
      if (fullAddress) {
        updateEditForm({ insurer_address: fullAddress });
        showAlert(`Insurer address fetched from Insurer Master (${match.company_name})`);
      } else {
        showAlert('Insurer found but no address on record', 'error');
      }
    } else {
      showAlert('Insurer name not found in Insurer Master', 'error');
    }
    setFetchingInsurer(false);
  }

  async function saveClaim() {
    try {
      setSaving(true);
      const payload = { ...editForm, id };
      // Clean numeric fields
      ['estimated_loss_amount', 'tax_invoice_amount', 'gross_assessed_amount', 'gst_amount', 'total_after_gst', 'not_covered_amount', 'net_adjusted_amount'].forEach(f => {
        if (payload[f] === '' || payload[f] === null) delete payload[f];
        else if (payload[f]) payload[f] = parseFloat(payload[f]);
      });
      // Clean empty date fields
      ['date_of_intimation', 'report_date', 'date_of_registration', 'certificate_from', 'certificate_to', 'complaint_date', 'survey_date', 'reinspection_date', 'tax_invoice_date'].forEach(f => {
        if (!payload[f]) delete payload[f];
      });

      const res = await fetch('/api/ew-claims', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated = await res.json();
      setClaim(updated);
      setEditForm(updated);

      // Write-back shared fields to the linked parent claim (bidirectional sync)
      // so Claim Registration and Claim Detail pages reflect the same values.
      if (updated && updated.claim_id) {
        try {
          const syncPayload = {};
          SHARED_FIELDS.forEach(f => {
            if (editForm[f] !== undefined && editForm[f] !== null) syncPayload[f] = editForm[f];
          });
          // Map date_of_intimation (ew) -> date_intimation (claims)
          if (editForm.date_of_intimation) {
            syncPayload.date_intimation = editForm.date_of_intimation;
          }
          // Normalize numeric
          if (syncPayload.estimated_loss_amount === '' || syncPayload.estimated_loss_amount === undefined) {
            delete syncPayload.estimated_loss_amount;
          } else if (syncPayload.estimated_loss_amount != null) {
            const n = parseFloat(syncPayload.estimated_loss_amount);
            if (!isNaN(n)) syncPayload.estimated_loss_amount = n;
          }
          // Flag to stop the /api/claims PUT from re-syncing back to EW and looping
          syncPayload._skip_ew_sync = true;
          await fetch(`/api/claims/${updated.claim_id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(syncPayload),
          });
        } catch (syncErr) {
          console.warn('Parent claim sync failed (non-fatal):', syncErr);
        }
      }

      showAlert('Claim data saved');
    } catch (e) {
      showAlert(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function updateStageStatus(stageNum, newStatus) {
    try {
      const stage = stages.find(s => s.stage_number === stageNum);
      if (!stage) return;
      const res = await fetch('/api/ew-claim-stages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ew_claim_id: id,
          stage_number: stageNum,
          status: newStatus,
          notes: stageNotes[stageNum] || '',
          updated_by: user?.email || '',
        }),
      });
      if (!res.ok) throw new Error('Stage update failed');
      showAlert(`Stage ${stageNum} marked as ${newStatus}`);
      loadAll(); // Reload to get updated claim + stages
    } catch (e) {
      showAlert(e.message, 'error');
    }
  }

  async function saveStageNotes(stageNum) {
    try {
      const stage = stages.find(s => s.stage_number === stageNum);
      if (!stage) return;
      await fetch('/api/ew-claim-stages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: stage.id,
          notes: stageNotes[stageNum] || '',
          updated_by: user?.email || '',
        }),
      });
      showAlert(`Stage ${stageNum} notes saved`);
    } catch (e) {
      showAlert(e.message, 'error');
    }
  }

  async function handleFileUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    try {
      setUploadingMedia(true);
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('ew_claim_id', id);
        formData.append('stage_number', mediaStageFilter === 'all' ? claim?.current_stage || 1 : mediaStageFilter);
        formData.append('media_type', file.type.startsWith('video/') ? 'video' : 'photo');
        formData.append('uploaded_by', user?.email || '');
        const res = await fetch('/api/ew-claim-media', { method: 'POST', body: formData });
        if (!res.ok) throw new Error(`Upload failed for ${file.name}`);
      }
      showAlert(`${files.length} file(s) uploaded`);
      loadAll();
    } catch (e) {
      showAlert(e.message, 'error');
    } finally {
      setUploadingMedia(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function deleteMedia(mediaId) {
    if (!confirm('Delete this file?')) return;
    try {
      const res = await fetch(`/api/ew-claim-media?id=${mediaId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      showAlert('File deleted');
      loadAll();
    } catch (e) {
      showAlert(e.message, 'error');
    }
  }

  const [fsrHtml, setFsrHtml] = useState(null);
  const [showFsrExport, setShowFsrExport] = useState(false);

  async function generateFSR(format) {
    try {
      setGeneratingFSR(true);
      // Always refetch — never use stale cached HTML so the latest server
      // template is picked up after deploys / data edits.
      const res = await fetch(`/api/ew-fsr-generate?_=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        cache: 'no-store',
        body: JSON.stringify({ ew_claim_id: id }),
      });
      if (!res.ok) throw new Error('FSR generation failed');
      const data = await res.json();
      const html = data.html;
      setFsrHtml(html);

      const fname = `FSR-${claim?.ref_number || 'report'}`;
      if (format === 'pdf') {
        await downloadAsPDF(html, `${fname}.pdf`);
        showAlert('FSR downloaded as PDF');
      } else if (format === 'word') {
        downloadAsWord(html, `${fname}.doc`);
        showAlert('FSR downloaded as Word document');
      } else {
        setShowFsrExport(true);
        showAlert('FSR generated! Choose your download format.');
      }
    } catch (e) {
      showAlert(e.message, 'error');
    } finally {
      setGeneratingFSR(false);
    }
  }

  function printFSR() {
    if (!fsrHtml) return;
    const win = window.open('', '_blank');
    win.document.write(fsrHtml);
    win.document.close();
    win.print();
  }

  const gridStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 18px' };
  const grid3Style = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 18px' };

  // Common props passed to every F component
  const fp = { editForm, updateEditForm };

  // Small fetch button style
  const fetchBtnStyle = {
    padding: '4px 10px', fontSize: 10, fontWeight: 600, border: 'none', borderRadius: 5,
    cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4,
  };

  if (loading) {
    return (
      <PageLayout>
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading EW claim...</div>
      </PageLayout>
    );
  }

  if (!claim) {
    return (
      <PageLayout>
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
          Claim not found.
          <button onClick={() => router.push('/ew-vehicle-claims')} style={{ marginLeft: 12, color: '#7c3aed', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            Back to list
          </button>
        </div>
      </PageLayout>
    );
  }

  const completedCount = stages.filter(s => s.status === 'Completed').length;
  const progressPct = Math.round((completedCount / 12) * 100);
  const filteredMedia = mediaStageFilter === 'all' ? media : media.filter(m => m.stage_number === parseInt(mediaStageFilter));

  return (
    <PageLayout>
      <div style={{ padding: '16px 20px', maxWidth: 1400, margin: '0 auto' }}>
        {/* Alert */}
        {alert && (
          <div style={{
            padding: '8px 14px', marginBottom: 12, borderRadius: 8,
            background: alert.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: alert.type === 'success' ? '#166534' : '#991b1b',
            border: `1px solid ${alert.type === 'success' ? '#86efac' : '#fca5a5'}`,
            fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>{alert.msg}</span>
            <span onClick={() => setAlert(null)} style={{ cursor: 'pointer', fontWeight: 700 }}>&#x2715;</span>
          </div>
        )}

        {/* Top Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <button onClick={() => router.push('/ew-vehicle-claims')} style={{
                background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed', fontSize: 16, padding: 0,
              }}>&#x2190;</button>
              <h2 style={{ margin: 0, fontSize: 20, color: '#1e293b' }}>
                {claim.ref_number || 'EW Claim'}
              </h2>
              <span style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                background: STAGE_STATUS_COLORS[claim.status]?.bg || '#f1f5f9',
                color: STAGE_STATUS_COLORS[claim.status]?.color || '#64748b',
              }}>{claim.status}</span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
              {claim.customer_name || claim.insured_name || '-'} &#x2022; {claim.vehicle_reg_no || '-'} &#x2022; {claim.vehicle_make || ''} {claim.model_fuel_type || ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => generateFSR()}
              disabled={generatingFSR}
              style={{
                padding: '8px 16px', background: generatingFSR ? '#a78bfa' : '#059669', color: '#fff',
                border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: generatingFSR ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{ fontSize: 16 }}>&#x1F4C4;</span>
              {generatingFSR ? 'Generating...' : 'Generate FSR'}
            </button>
            {fsrHtml && (
              <>
                <button onClick={() => generateFSR('pdf')} style={{ padding: '8px 12px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>PDF</button>
                <button onClick={() => generateFSR('word')} style={{ padding: '8px 12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Word</button>
                <button onClick={printFSR} style={{ padding: '8px 12px', background: '#6b7280', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Print</button>
              </>
            )}
            <button
              onClick={saveClaim}
              disabled={saving}
              style={{
                padding: '8px 16px', background: saving ? '#a78bfa' : '#7c3aed', color: '#fff',
                border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer',
              }}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
              Stage {claim.current_stage}/12: {claim.current_stage_name}
            </span>
            <span style={{ fontSize: 12, color: '#7c3aed', fontWeight: 700 }}>{progressPct}%</span>
          </div>
          <div style={{ height: 8, background: '#e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progressPct}%`, background: 'linear-gradient(90deg, #7c3aed, #a78bfa)', borderRadius: 8, transition: 'width 0.5s' }} />
          </div>
        </div>

        {/* 12-Stage Lifecycle Timeline */}
        <div style={{
          background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '16px 20px', marginBottom: 16,
        }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>&#x1F504;</span> Claim Lifecycle
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4 }}>
            {EW_STAGES.map(es => {
              const stageData = stages.find(s => s.stage_number === es.number);
              const status = stageData?.status || 'Pending';
              const isCurrent = claim.current_stage === es.number;
              return (
                <div key={es.number} style={{ textAlign: 'center' }}>
                  <div
                    style={{
                      width: 36, height: 36, borderRadius: '50%', margin: '0 auto 4px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: status === 'Completed' ? '#22c55e' : status === 'In Progress' ? '#f59e0b' : '#e2e8f0',
                      color: status === 'Completed' || status === 'In Progress' ? '#fff' : '#94a3b8',
                      fontSize: 12, fontWeight: 700,
                      border: isCurrent ? '3px solid #7c3aed' : '2px solid transparent',
                      boxShadow: isCurrent ? '0 0 0 3px rgba(124,58,237,0.2)' : 'none',
                      transition: 'all 0.2s',
                    }}
                  >
                    {status === 'Completed' ? '\u2713' : es.number}
                  </div>
                  <div style={{ fontSize: 9, color: isCurrent ? '#7c3aed' : '#64748b', fontWeight: isCurrent ? 700 : 500, lineHeight: 1.2 }}>
                    {es.short}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Stage Action Buttons */}
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
            {stages.map(s => {
              if (s.status !== 'In Progress') return null;
              return (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
                    Stage {s.stage_number}: {s.stage_name}
                  </span>
                  <textarea
                    placeholder="Stage notes..."
                    value={stageNotes[s.stage_number] || ''}
                    onChange={e => setStageNotes(prev => ({ ...prev, [s.stage_number]: e.target.value }))}
                    style={{ flex: 1, minWidth: 200, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, minHeight: 32, resize: 'vertical' }}
                  />
                  <button
                    onClick={() => saveStageNotes(s.stage_number)}
                    style={{ padding: '6px 12px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
                  >
                    Save Notes
                  </button>
                  <button
                    onClick={() => updateStageStatus(s.stage_number, 'Completed')}
                    style={{
                      padding: '6px 14px', background: '#22c55e', color: '#fff', border: 'none',
                      borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    &#x2713; Complete Stage
                  </button>
                  <button
                    onClick={() => updateStageStatus(s.stage_number, 'Skipped')}
                    style={{
                      padding: '6px 14px', background: '#94a3b8', color: '#fff', border: 'none',
                      borderRadius: 6, fontSize: 11, cursor: 'pointer',
                    }}
                  >
                    Skip
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main Content: Data Tabs + Form */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          {/* Tab Bar */}
          <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', overflowX: 'auto' }}>
            {DATA_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '10px 18px', border: 'none', background: 'none',
                  borderBottom: activeTab === tab.key ? '3px solid #7c3aed' : '3px solid transparent',
                  color: activeTab === tab.key ? '#7c3aed' : '#64748b',
                  fontSize: 13, fontWeight: activeTab === tab.key ? 700 : 500,
                  cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.2s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ padding: 20 }}>
            {/* CLAIM DETAILS TAB */}
            {activeTab === 'claim' && (
              <div style={gridStyle}>
                <F label="Ref Number" field="ref_number" {...fp} />
                <F label="Report Date" field="report_date" type="date" {...fp} />
                <F label="Insured Name" field="insured_name" {...fp} />
                <F label="Insurer Name" field="insurer_name" {...fp} />

                {/* Insured Address with Fetch from Policy Master */}
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                    <label style={LABEL_STYLE}>Insured Address</label>
                    <button
                      onClick={fetchFromPolicyMaster}
                      disabled={fetchingPolicy}
                      style={{ ...fetchBtnStyle, background: '#fef3c7', color: '#92400e' }}
                      title="Fetch insured address from Policy Master using the policy number above"
                    >
                      {fetchingPolicy ? 'Fetching...' : 'Fetch from Policy Master'}
                    </button>
                  </div>
                  <textarea
                    value={editForm.insured_address || ''}
                    onChange={e => updateEditForm({ insured_address: e.target.value })}
                    style={{ ...FIELD_STYLE, minHeight: 60, resize: 'vertical' }}
                  />
                </div>

                {/* Insurer Address with Fetch from Insurer Master */}
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                    <label style={LABEL_STYLE}>Insurer Address</label>
                    <button
                      onClick={fetchFromInsurerMaster}
                      disabled={fetchingInsurer}
                      style={{ ...fetchBtnStyle, background: '#dbeafe', color: '#1e40af' }}
                      title="Fetch insurer address from Insurer Master using the insurer name above"
                    >
                      {fetchingInsurer ? 'Fetching...' : 'Fetch from Insurer Master'}
                    </button>
                  </div>
                  <textarea
                    value={editForm.insurer_address || ''}
                    onChange={e => updateEditForm({ insurer_address: e.target.value })}
                    style={{ ...FIELD_STYLE, minHeight: 60, resize: 'vertical' }}
                  />
                </div>

                <F label="Policy Number" field="policy_number" {...fp} />
                <F label="Claim File No." field="claim_file_no" {...fp} />
                <F label="Person Contacted" field="person_contacted" {...fp} />
                <F label="Estimated Loss Amount" field="estimated_loss_amount" type="number" {...fp} />
                <F label="Date of Intimation" field="date_of_intimation" type="date" {...fp} />
              </div>
            )}

            {/* VEHICLE / CERTIFICATE TAB */}
            {activeTab === 'vehicle' && (
              <div>
                <div style={grid3Style}>
                  <F label="Customer Name" field="customer_name" {...fp} />
                  <F label="Vehicle Reg. No." field="vehicle_reg_no" {...fp} />
                  <F label="Date of Registration" field="date_of_registration" type="date" {...fp} />
                  <F label="Vehicle Make" field="vehicle_make" {...fp} />
                  <F label="Model / Fuel Type" field="model_fuel_type" {...fp} />
                  <F label="Chassis Number" field="chassis_number" {...fp} />
                  <F label="Engine Number" field="engine_number" {...fp} />
                  <F label="Odometer Reading" field="odometer_reading" {...fp} />
                  <F label="Warranty Plan" field="warranty_plan" {...fp} />
                  <F label="Certificate No." field="certificate_no" {...fp} />
                  <F label="Certificate From" field="certificate_from" type="date" {...fp} />
                  <F label="Certificate To" field="certificate_to" type="date" {...fp} />
                  <F label="Certificate KMs" field="certificate_kms" {...fp} />
                </div>
                <div style={{ ...gridStyle, marginTop: 14 }}>
                  <F label="Dealer Name" field="dealer_name" {...fp} />
                  <F label="Dealer Contact" field="dealer_contact" {...fp} />
                  <F label="Dealer Address" field="dealer_address" span={2} textarea {...fp} />
                  <F label="Certificate Validity" field="certificate_validity_text" span={2} textarea {...fp} />
                  <F label="Product Description" field="product_description" span={2} textarea {...fp} />
                  <F label="Terms & Conditions" field="terms_conditions" span={2} textarea {...fp} />
                  <F label="Customer Complaint" field="customer_complaint" span={2} textarea {...fp} />
                  <F label="Complaint Date" field="complaint_date" type="date" {...fp} />
                </div>
              </div>
            )}

            {/* SURVEY & FINDINGS TAB */}
            {activeTab === 'survey' && (
              <div style={gridStyle}>
                <F label="Survey / Inspection Date" field="survey_date" type="date" {...fp} />
                <F label="Survey Location" field="survey_location" {...fp} />
                <F label="Initial Observation" field="initial_observation" span={2} textarea rows={4} {...fp} />
                <F label="Dismantled Observation" field="dismantled_observation" span={2} textarea rows={4} {...fp} />
                <F label="Defective Parts" field="defective_parts" span={2} textarea rows={3} {...fp} />
                <F label="External Damages" field="external_damages" span={2} textarea {...fp} />
                <div>
                  <label style={LABEL_STYLE}>Service History Verified</label>
                  <select
                    value={editForm.service_history_verified === false ? 'false' : 'true'}
                    onChange={e => updateEditForm({ service_history_verified: e.target.value === 'true' })}
                    style={FIELD_STYLE}
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
              </div>
            )}

            {/* ASSESSMENT TAB */}
            {activeTab === 'assessment' && (
              <div>
                <h4 style={{ margin: '0 0 12px', fontSize: 14, color: '#1e293b' }}>Reinspection</h4>
                <div style={gridStyle}>
                  <F label="Reinspection Date" field="reinspection_date" type="date" {...fp} />
                  <F label="Reinspection Notes" field="reinspection_notes" span={1} textarea {...fp} />
                </div>

                <h4 style={{ margin: '20px 0 12px', fontSize: 14, color: '#1e293b' }}>Tax Invoice</h4>
                <div style={grid3Style}>
                  <F label="Tax Invoice No." field="tax_invoice_no" {...fp} />
                  <F label="Tax Invoice Date" field="tax_invoice_date" type="date" {...fp} />
                  <F label="Tax Invoice Amount" field="tax_invoice_amount" type="number" {...fp} />
                  <F label="Dealer Invoice Name" field="dealer_invoice_name" {...fp} />
                </div>

                <h4 style={{ margin: '20px 0 12px', fontSize: 14, color: '#1e293b' }}>Assessment of Loss</h4>
                <div style={grid3Style}>
                  <F label="Gross Assessed Amount" field="gross_assessed_amount" type="number" {...fp} />
                  <F label="GST Amount" field="gst_amount" type="number" {...fp} />
                  <F label="Total After GST" field="total_after_gst" type="number" {...fp} />
                  <F label="Not Covered Amount" field="not_covered_amount" type="number" {...fp} />
                  <F label="Net Adjusted Amount" field="net_adjusted_amount" type="number" {...fp} />
                  <F label="Amount in Words" field="amount_in_words" {...fp} />
                </div>
              </div>
            )}

            {/* CONCLUSION TAB */}
            {activeTab === 'conclusion' && (
              <div>
                <F label="Conclusion Text" field="conclusion_text" span={2} textarea rows={8} {...fp} />
              </div>
            )}

            {/* MEDIA TAB */}
            {activeTab === 'media' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Stage:</label>
                    <select
                      value={mediaStageFilter}
                      onChange={e => setMediaStageFilter(e.target.value)}
                      style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
                    >
                      <option value="all">All Stages</option>
                      {EW_STAGES.map(s => <option key={s.number} value={s.number}>Stage {s.number}: {s.name}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,video/*"
                      onChange={handleFileUpload}
                      style={{ display: 'none' }}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingMedia}
                      style={{
                        padding: '8px 16px', background: uploadingMedia ? '#a78bfa' : '#7c3aed', color: '#fff',
                        border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
                        cursor: uploadingMedia ? 'default' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      <span style={{ fontSize: 16 }}>&#x1F4F7;</span>
                      {uploadingMedia ? 'Uploading...' : 'Upload Photos / Videos'}
                    </button>
                  </div>
                </div>

                {filteredMedia.length === 0 ? (
                  <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                    No media files uploaded yet for {mediaStageFilter === 'all' ? 'this claim' : `stage ${mediaStageFilter}`}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                    {filteredMedia.map(m => (
                      <div key={m.id} style={{
                        border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden',
                        background: '#f8fafc',
                      }}>
                        {m.media_type === 'video' ? (
                          <video
                            src={m.file_url}
                            style={{ width: '100%', height: 120, objectFit: 'cover', background: '#000' }}
                            controls
                          />
                        ) : (
                          <img
                            src={m.file_url}
                            alt={m.file_name}
                            style={{ width: '100%', height: 120, objectFit: 'cover' }}
                            onError={e => { e.target.style.display = 'none'; }}
                          />
                        )}
                        <div style={{ padding: '8px 10px' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.file_name}
                          </div>
                          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                            Stage {m.stage_number} &#x2022; {m.file_size ? `${(m.file_size / 1024).toFixed(0)}KB` : ''}
                          </div>
                          <button
                            onClick={() => deleteMedia(m.id)}
                            style={{
                              marginTop: 6, padding: '3px 8px', background: '#fee2e2', color: '#dc2626',
                              border: '1px solid #fca5a5', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Save button at bottom of form tabs */}
            {activeTab !== 'media' && (
              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={saveClaim}
                  disabled={saving}
                  style={{
                    padding: '10px 24px', background: saving ? '#a78bfa' : '#7c3aed', color: '#fff',
                    border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
                    cursor: saving ? 'default' : 'pointer',
                  }}
                >
                  {saving ? 'Saving...' : 'Save All Changes'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FSR Export Format Modal */}
      {showFsrExport && fsrHtml && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 420, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16, color: '#1e293b' }}>Download FSR Report</h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#64748b' }}>Choose your preferred format:</p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button onClick={() => { generateFSR('pdf'); setShowFsrExport(false); }} style={{ flex: 1, padding: '12px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                &#x1F4C4; Download PDF
              </button>
              <button onClick={() => { generateFSR('word'); setShowFsrExport(false); }} style={{ flex: 1, padding: '12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                &#x1F4DD; Download Word
              </button>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { printFSR(); setShowFsrExport(false); }} style={{ flex: 1, padding: '10px', background: '#f1f5f9', color: '#475569', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
                Print
              </button>
              <button onClick={() => setShowFsrExport(false)} style={{ flex: 1, padding: '10px', background: '#f1f5f9', color: '#475569', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

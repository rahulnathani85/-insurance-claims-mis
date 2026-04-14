'use client';
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';
import { downloadAsPDF, downloadAsWord } from '@/lib/documentExport';
import { EW_STAGES, STAGE_COUNT } from '@/lib/ewStages';
import { FILE_SERVER_URL, FILE_SERVER_KEY } from '@/lib/constants';
import { logActivity, ACTIONS } from '@/lib/activityLogger';

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
  { key: 'activity', label: 'Activity Log', adminOnly: true },
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
  const [showPreview, setShowPreview] = useState(false);
  const [mediaStageFilter, setMediaStageFilter] = useState('all');
  const fileInputRef = useRef(null);

  // Surveyor list for assignment
  const [surveyorList, setSurveyorList] = useState([]);
  // Document categories for organized uploads
  const [docCategories, setDocCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  // Activity log (admin only)
  const [activityLogs, setActivityLogs] = useState([]);

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
      fetch('/api/surveyors')
        .then(r => r.json()).then(d => setSurveyorList(Array.isArray(d) ? d : [])).catch(() => setSurveyorList([]));
      fetch('/api/ew-document-categories')
        .then(r => r.json()).then(d => setDocCategories(Array.isArray(d) ? d : [])).catch(() => setDocCategories([]));
    }
  }, [company]);

  // Shared fields that live in both claims and ew_vehicle_claims.
  const SHARED_FIELDS = [
    'insured_name',
    'insured_address',
    'policy_number',
    'claim_file_no',
    'person_contacted',
    'estimated_loss_amount',
    'date_of_intimation',
    'appointing_office_id', 'appointing_office_name', 'appointing_office_address',
    'policy_office_id', 'policy_office_name', 'policy_office_address',
    'fsr_office_id', 'fsr_office_name', 'fsr_office_address',
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
      // Load activity logs by ref_number (captures all actions for this claim file)
      if (user?.role === 'Admin' && merged?.ref_number) {
        fetch(`/api/activity-log?ref_number=${encodeURIComponent(merged.ref_number)}`).then(r => r.json()).then(d => setActivityLogs(Array.isArray(d) ? d.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) : [])).catch(() => {});
      }
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

  // When user selects an insurer office for a role, auto-fill name + address
  function selectOfficeForRole(role, officeId) {
    if (!officeId) {
      updateEditForm({ [`${role}_office_id`]: null, [`${role}_office_name`]: '', [`${role}_office_address`]: '' });
      return;
    }
    for (const ins of insurers) {
      const office = (ins.insurer_offices || []).find(o => String(o.id) === String(officeId));
      if (office) {
        const parts = [office.name || ins.company_name, office.address, office.city, office.state, office.pin].filter(Boolean);
        updateEditForm({
          [`${role}_office_id`]: office.id,
          [`${role}_office_name`]: `${ins.company_name} - ${office.name || office.type || 'Office'}`,
          [`${role}_office_address`]: parts.slice(1).join(', '),
        });
        showAlert(`${role.charAt(0).toUpperCase() + role.slice(1)} office set to ${ins.company_name} - ${office.name || office.type}`);
        return;
      }
    }
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
      logActivity({ userEmail: user?.email, userName: user?.name, action: ACTIONS.CHANGES_SAVED, entityType: 'ew_vehicle_claims', entityId: id, refNumber: claim?.ref_number, details: 'Claim data saved', company: claim?.company });
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
      logActivity({ userEmail: user?.email, userName: user?.name, action: newStatus === 'Completed' ? ACTIONS.STAGE_COMPLETED : newStatus === 'Skipped' ? ACTIONS.STAGE_SKIPPED : ACTIONS.STAGE_UPDATED, entityType: 'ew_claim_stages', entityId: id, refNumber: claim?.ref_number, details: { stage_number: stageNum, new_status: newStatus }, company: claim?.company });
      loadAll();
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
    // Get selected category from the dropdown
    const categorySelect = document.getElementById('upload-category');
    const docCategory = categorySelect?.value || 'other';
    try {
      setUploadingMedia(true);
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('ew_claim_id', id);
        formData.append('stage_number', mediaStageFilter === 'all' ? claim?.current_stage || 1 : mediaStageFilter);
        formData.append('media_type', file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'photo' : 'document');
        formData.append('uploaded_by', user?.email || '');
        formData.append('document_category', docCategory);
        const res = await fetch('/api/ew-claim-media', { method: 'POST', body: formData });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Upload failed for ${file.name}`);
        }
      }
      showAlert(`${files.length} file(s) uploaded`);
      logActivity({ userEmail: user?.email, userName: user?.name, action: ACTIONS.DOCUMENT_UPLOADED, entityType: 'ew_claim_media', entityId: id, refNumber: claim?.ref_number, details: { files_count: files.length, file_names: Array.from(files).map(f => f.name) }, company: claim?.company });
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

  // Fetch FSR HTML only (for preview) — no download, no popup
  async function fetchFsrHtml() {
    try {
      setGeneratingFSR(true);
      const res = await fetch(`/api/ew-fsr-generate?_=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        cache: 'no-store',
        body: JSON.stringify({ ew_claim_id: id }),
      });
      if (!res.ok) throw new Error('FSR generation failed');
      const data = await res.json();
      setFsrHtml(data.html);
      return data.html;
    } catch (e) {
      showAlert(e.message, 'error');
      return null;
    } finally {
      setGeneratingFSR(false);
    }
  }

  // Generate FSR, download, and save to cloud folder
  async function generateFSR(format) {
    try {
      setGeneratingFSR(true);
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
        // Save PDF to claim folder
        saveToCloudFolder(html, fname, 'pdf');
        logActivity({ userEmail: user?.email, userName: user?.name, action: ACTIONS.FSR_DOWNLOADED_PDF, entityType: 'ew_vehicle_claims', entityId: id, refNumber: claim?.ref_number, details: { format: 'pdf', filename: `${fname}.pdf` }, company: claim?.company });
        showAlert('FSR downloaded as PDF and saved to claim folder');
      } else if (format === 'word') {
        downloadAsWord(html, `${fname}.doc`);
        // Save Word to claim folder
        saveToCloudFolder(html, fname, 'word');
        logActivity({ userEmail: user?.email, userName: user?.name, action: ACTIONS.FSR_DOWNLOADED_WORD, entityType: 'ew_vehicle_claims', entityId: id, refNumber: claim?.ref_number, details: { format: 'word', filename: `${fname}.doc` }, company: claim?.company });
        showAlert('FSR downloaded as Word and saved to claim folder');
      } else {
        setShowFsrExport(true);
        showAlert('FSR generated! Choose your download format.');
      }

      logActivity({ userEmail: user?.email, userName: user?.name, action: ACTIONS.FSR_GENERATED, entityType: 'ew_vehicle_claims', entityId: id, refNumber: claim?.ref_number, details: { format: format || 'preview' }, company: claim?.company });
    } catch (e) {
      showAlert(e.message, 'error');
    } finally {
      setGeneratingFSR(false);
    }
  }

  // Save FSR file to the claim's cloud folder (Word or PDF placeholder)
  async function saveToCloudFolder(html, fname, format = 'word') {
    try {
      // Get the parent claim's folder_path
      let folderPath = '';
      if (claim?.claim_id) {
        const claimRes = await fetch(`/api/claims/${claim.claim_id}`);
        const parentClaim = await claimRes.json();
        folderPath = parentClaim?.folder_path || '';
      }
      if (!folderPath) return; // No folder path, skip save

      const relativePath = folderPath.replace(/^D:\\\\2026-27\\\\?/, '').replace(/^D:\\2026-27\\?/, '');
      if (!relativePath) return;

      // Save to FSR subfolder
      const fsrFolder = `${relativePath}\\FSR`;

      // Create file as Blob
      let blob, fileName;
      if (format === 'word') {
        const wordHtml = buildWordHtml(html);
        blob = new Blob(['\ufeff', wordHtml], { type: 'application/msword' });
        fileName = `${fname}.doc`;
      } else {
        // For PDF, save the HTML as .html (user can print to PDF from there)
        blob = new Blob([html], { type: 'text/html' });
        fileName = `${fname}.html`;
      }
      const file = new File([blob], fileName, { type: blob.type });

      const fd = new FormData();
      fd.append('files', file);
      fd.append('folder_path', fsrFolder);

      const uploadRes = await fetch(`${FILE_SERVER_URL}/api/upload?folder_path=${encodeURIComponent(fsrFolder)}`, {
        method: 'POST',
        headers: { 'X-API-Key': FILE_SERVER_KEY },
        body: fd,
      });
      const uploadData = await uploadRes.json();
      if (uploadData.success) {
        showAlert('FSR saved to claim folder', 'success');
      }
    } catch (e) {
      console.warn('Cloud folder save failed (non-fatal):', e.message);
    }
  }

  // Build Word-compatible HTML from FSR HTML
  function buildWordHtml(htmlContent) {
    const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : htmlContent;
    const styleMatch = [...htmlContent.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
    const cleanCss = styleMatch
      .replace(/display:\s*flex[^;]*/gi, 'display: block')
      .replace(/flex-direction:[^;]*/gi, '').replace(/flex:[^;]*/gi, '')
      .replace(/justify-content:[^;]*/gi, '').replace(/align-items:[^;]*/gi, '')
      .replace(/width:\s*794px/gi, 'width: 100%').replace(/min-height:\s*\d+px/gi, 'min-height: auto')
      .replace(/position:\s*(relative|fixed|absolute)/gi, 'position: static');

    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml>
<style>
@page Section1 { size: 21cm 29.7cm; margin: 1.5cm 1.5cm 1.8cm 1.5cm; }
div.Section1 { page: Section1; }
body { font-family: 'Times New Roman', serif; font-size: 11pt; line-height: 1.45; }
.page { width: 100%; display: block; page-break-after: always; }
.page:last-child { page-break-after: auto; }
.ref-row { overflow: hidden; } .ref-row span:first-child { float: left; } .ref-row span:last-child { float: right; }
table { border-collapse: collapse; width: 100%; } td, th { border: 0.5pt solid #444; padding: 5px 8px; vertical-align: top; }
${cleanCss}
</style></head><body><div class="Section1">${bodyContent}</div></body></html>`;
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
  const progressPct = Math.round((completedCount / STAGE_COUNT) * 100);
  const currentStageData = stages.find(s => s.status === 'In Progress');
  const isOverdue = claim.sla_due_date && new Date(claim.sla_due_date) < new Date();
  let filteredMedia = media;
  if (mediaStageFilter !== 'all') filteredMedia = filteredMedia.filter(m => m.stage_number === parseInt(mediaStageFilter));
  if (selectedCategory !== 'all') filteredMedia = filteredMedia.filter(m => m.document_category === selectedCategory);

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
              {isOverdue && (
                <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#fee2e2', color: '#991b1b' }}>OVERDUE</span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
              {claim.customer_name || claim.insured_name || '-'} &#x2022; {claim.vehicle_reg_no || '-'} &#x2022; {claim.vehicle_make || ''} {claim.model_fuel_type || ''}
              {claim.assigned_surveyor_name && <> &#x2022; <span style={{ color: '#7c3aed', fontWeight: 600 }}>Surveyor: {claim.assigned_surveyor_name}</span></>}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={async () => {
                if (!showPreview) { await fetchFsrHtml(); setShowPreview(true); }
                else { setShowPreview(false); }
              }}
              disabled={generatingFSR}
              style={{
                padding: '8px 16px', background: showPreview ? '#1e40af' : '#f1f5f9', color: showPreview ? '#fff' : '#475569',
                border: showPreview ? 'none' : '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: generatingFSR ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {generatingFSR ? 'Loading...' : showPreview ? '✕ Close Preview' : '👁 Preview FSR'}
            </button>
            {!showPreview && (
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

        {/* Split Layout: Left = Form, Right = FSR Preview */}
        <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: showPreview ? '0 0 55%' : '1 1 100%', minWidth: 0, transition: 'flex 0.3s' }}>

        {/* Progress Bar */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
              Stage {claim.current_stage}/{STAGE_COUNT}: {claim.current_stage_name}
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
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGE_COUNT}, 1fr)`, gap: 6 }}>
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

          {/* Quick-Action Panel: Current Stage + Surveyor + SLA */}
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f1f5f9', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {/* Left: Current Stage Actions */}
            <div>
              {currentStageData ? (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
                    Stage {currentStageData.stage_number}: {currentStageData.stage_name}
                  </div>
                  <textarea
                    placeholder="Stage notes..."
                    value={stageNotes[currentStageData.stage_number] || ''}
                    onChange={e => setStageNotes(prev => ({ ...prev, [currentStageData.stage_number]: e.target.value }))}
                    style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, minHeight: 40, resize: 'vertical', boxSizing: 'border-box', marginBottom: 8 }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={async () => { await saveStageNotes(currentStageData.stage_number); updateStageStatus(currentStageData.stage_number, 'Completed'); }}
                      style={{ flex: 1, padding: '8px 14px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                    >
                      &#x2713; Complete &amp; Advance
                    </button>
                    <button
                      onClick={() => saveStageNotes(currentStageData.stage_number)}
                      style={{ padding: '8px 12px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
                    >
                      Save Notes
                    </button>
                    <button
                      onClick={() => updateStageStatus(currentStageData.stage_number, 'Skipped')}
                      style={{ padding: '8px 12px', background: '#94a3b8', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
                    >
                      Skip
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#94a3b8' }}>All stages completed or no active stage</div>
              )}
            </div>

            {/* Right: Surveyor + SLA */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 3 }}>Assigned Surveyor</label>
                <select
                  value={editForm.assigned_surveyor || ''}
                  onChange={e => {
                    const sv = surveyorList.find(s => s.name === e.target.value);
                    updateEditForm({ assigned_surveyor: e.target.value, assigned_surveyor_name: sv?.name || e.target.value });
                  }}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }}
                >
                  <option value="">-- Select Surveyor --</option>
                  {surveyorList.map(s => <option key={s.id} value={s.name}>{s.name}{s.designation ? ` (${s.designation})` : ''}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 3 }}>SLA Due Date</label>
                <input
                  type="date"
                  value={editForm.sla_due_date || ''}
                  onChange={e => updateEditForm({ sla_due_date: e.target.value })}
                  style={{
                    width: '100%', padding: '7px 10px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box',
                    border: isOverdue ? '2px solid #ef4444' : '1px solid #d1d5db',
                    background: isOverdue ? '#fef2f2' : '#fff',
                  }}
                />
                {isOverdue && <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>Past due!</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Main Content: Data Tabs + Form */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          {/* Tab Bar */}
          <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', overflowX: 'auto' }}>
            {DATA_TABS.filter(tab => !tab.adminOnly || user?.role === 'Admin').map(tab => (
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
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                    <label style={LABEL_STYLE}>Insured Address</label>
                    <button onClick={fetchFromPolicyMaster} disabled={fetchingPolicy} style={{ ...fetchBtnStyle, background: '#fef3c7', color: '#92400e' }}>
                      {fetchingPolicy ? 'Fetching...' : 'Fetch from Policy Master'}
                    </button>
                  </div>
                  <textarea value={editForm.insured_address || ''} onChange={e => updateEditForm({ insured_address: e.target.value })} style={{ ...FIELD_STYLE, minHeight: 60, resize: 'vertical' }} />
                </div>
                <F label="Policy Number" field="policy_number" {...fp} />
                <F label="Claim File No." field="claim_file_no" {...fp} />
                <F label="Person Contacted" field="person_contacted" {...fp} />
                <F label="Estimated Loss Amount" field="estimated_loss_amount" type="number" {...fp} />
                <F label="Date of Intimation" field="date_of_intimation" type="date" {...fp} />

                {/* 3-Office Insurer Roles */}
                {[
                  { role: 'appointing', label: 'Appointing Office', textColor: '#92400e' },
                  { role: 'policy', label: 'Policy Issuing Office', textColor: '#1e40af' },
                  { role: 'fsr', label: 'FSR Submitting Office', textColor: '#166534' },
                ].map(({ role, label, textColor }) => (
                  <div key={role} style={{ gridColumn: 'span 2', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, background: '#fafafa' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: textColor, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: textColor, display: 'inline-block' }} />
                      {label}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px' }}>
                      <div>
                        <label style={LABEL_STYLE}>Select Office</label>
                        <select value={editForm[`${role}_office_id`] || ''} onChange={e => selectOfficeForRole(role, e.target.value)} style={FIELD_STYLE}>
                          <option value="">-- Select Office --</option>
                          {insurers.flatMap(ins => (ins.insurer_offices || []).map(o => (
                            <option key={o.id} value={o.id}>{ins.company_name} - {o.name || o.type || 'Office'} ({o.city || ''})</option>
                          )))}
                        </select>
                      </div>
                      <div>
                        <label style={LABEL_STYLE}>Office Name</label>
                        <input type="text" value={editForm[`${role}_office_name`] || ''} onChange={e => updateEditForm({ [`${role}_office_name`]: e.target.value })} style={FIELD_STYLE} />
                      </div>
                      <div style={{ gridColumn: 'span 2' }}>
                        <label style={LABEL_STYLE}>Office Address</label>
                        <input type="text" value={editForm[`${role}_office_address`] || ''} onChange={e => updateEditForm({ [`${role}_office_address`]: e.target.value })} style={FIELD_STYLE} />
                      </div>
                    </div>
                  </div>
                ))}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Category:</label>
                    <select
                      value={selectedCategory}
                      onChange={e => setSelectedCategory(e.target.value)}
                      style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
                    >
                      <option value="all">All Categories</option>
                      {docCategories.map(cat => <option key={cat.id} value={cat.code}>{cat.name}</option>)}
                    </select>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginLeft: 8 }}>Stage:</label>
                    <select
                      value={mediaStageFilter}
                      onChange={e => setMediaStageFilter(e.target.value)}
                      style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
                    >
                      <option value="all">All Stages</option>
                      {EW_STAGES.map(s => <option key={s.number} value={s.number}>Stage {s.number}: {s.name}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select id="upload-category" style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 11 }}>
                      {docCategories.map(cat => <option key={cat.id} value={cat.code}>{cat.name}</option>)}
                    </select>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx"
                      onChange={handleFileUpload}
                      style={{ display: 'none' }}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingMedia}
                      style={{
                        padding: '8px 14px', background: uploadingMedia ? '#a78bfa' : '#7c3aed', color: '#fff',
                        border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600,
                        cursor: uploadingMedia ? 'default' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      <span style={{ fontSize: 14 }}>📁</span>
                      {uploadingMedia ? 'Uploading...' : 'Upload Files'}
                    </button>
                  </div>
                </div>

                {/* Document Category Summary */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                  {docCategories.slice(0, 10).map(cat => {
                    const count = media.filter(m => m.document_category === cat.code).length;
                    return (
                      <div key={cat.id}
                        onClick={() => setSelectedCategory(selectedCategory === cat.code ? 'all' : cat.code)}
                        style={{
                          padding: '4px 10px', borderRadius: 12, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                          background: selectedCategory === cat.code ? '#7c3aed' : count > 0 ? '#dcfce7' : '#f1f5f9',
                          color: selectedCategory === cat.code ? '#fff' : count > 0 ? '#166534' : '#94a3b8',
                          border: `1px solid ${selectedCategory === cat.code ? '#7c3aed' : '#e2e8f0'}`,
                        }}>
                        {cat.name} ({count})
                      </div>
                    );
                  })}
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

            {/* ACTIVITY LOG TAB (admin only) */}
            {activeTab === 'activity' && user?.role === 'Admin' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h4 style={{ margin: 0, fontSize: 14, color: '#1e293b' }}>📋 Activity Log</h4>
                  <button onClick={() => {
                    if (claim?.ref_number) {
                      fetch(`/api/activity-log?ref_number=${encodeURIComponent(claim.ref_number)}`).then(r => r.json()).then(d => setActivityLogs(Array.isArray(d) ? d.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) : [])).catch(() => {});
                    }
                  }} style={{ padding: '4px 10px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>Refresh</button>
                </div>
                <p style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>All user actions on this claim with username and timestamp.</p>
                {activityLogs.length === 0 ? (
                  <p style={{ color: '#94a3b8', textAlign: 'center', padding: 20 }}>No activity logged yet. Actions will appear here as users work on this claim.</p>
                ) : (
                  <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                    {activityLogs.map((log, i) => (
                      <div key={log.id || i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                          {log.action?.includes('stage') ? '🔄' : log.action?.includes('document') || log.action?.includes('photo') ? '📄' : log.action?.includes('fsr') ? '📑' : log.action?.includes('saved') ? '💾' : '📝'}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                            {log.user_name || log.user_email || 'System'}
                            <span style={{ fontWeight: 400, color: '#64748b' }}> — {(log.action || '').replace(/_/g, ' ')}</span>
                          </div>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                            {log.created_at ? new Date(log.created_at).toLocaleString('en-IN') : '-'}
                          </div>
                          {log.details && (
                            <div style={{ fontSize: 11, color: '#475569', marginTop: 4, background: '#f8fafc', padding: '4px 8px', borderRadius: 4 }}>
                              {typeof log.details === 'string' ? log.details : JSON.stringify(log.details)}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Save button at bottom of form tabs */}
            {activeTab !== 'media' && activeTab !== 'activity' && (
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

        {/* Close left panel */}
        </div>

        {/* Right Panel: FSR Preview */}
        {showPreview && (
          <div style={{ flex: '0 0 43%', minWidth: 0, position: 'sticky', top: 16, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f0fdf4', borderBottom: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#166534' }}>FSR Preview</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => fetchFsrHtml()}
                    disabled={generatingFSR}
                    style={{ padding: '4px 10px', background: generatingFSR ? '#94a3b8' : '#059669', color: '#fff', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: generatingFSR ? 'default' : 'pointer' }}
                  >
                    {generatingFSR ? '...' : '↻ Refresh'}
                  </button>
                  <button onClick={() => setShowPreview(false)} style={{ padding: '4px 8px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>✕</button>
                </div>
              </div>
              {fsrHtml ? (
                <div style={{ transform: 'scale(0.65)', transformOrigin: 'top left', width: '154%', padding: 0 }} dangerouslySetInnerHTML={{ __html: fsrHtml }} />
              ) : (
                <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                  {generatingFSR ? 'Generating preview...' : 'Click "Refresh" to generate FSR preview'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Close split layout */}
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

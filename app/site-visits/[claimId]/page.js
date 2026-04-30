'use client';
import { useState, useEffect, useRef } from 'react';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

const STATUSES = ['planned', 'in_progress', 'completed', 'cancelled'];
const STATUS_LABEL = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default function SiteVisitsPage({ params }) {
  const { claimId } = params;
  const { user } = useAuth();
  const [claim, setClaim] = useState(null);
  const [visits, setVisits] = useState([]);
  const [surveyors, setSurveyors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState({});
  const [alert, setAlert] = useState(null);
  const [expandedVisit, setExpandedVisit] = useState(null);
  const [photosByVisit, setPhotosByVisit] = useState({});
  const [uploadingFor, setUploadingFor] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!claimId) return;
    loadAll();
  }, [claimId]);

  async function loadAll() {
    try {
      setLoading(true);
      const [claimRes, visitsRes, surveyorsRes] = await Promise.all([
        fetch(`/api/claims/${claimId}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/site-visits?claim_id=${claimId}`).then(r => r.json()).catch(() => []),
        fetch('/api/surveyors').then(r => r.json()).catch(() => []),
      ]);
      setClaim(claimRes);
      setVisits(Array.isArray(visitsRes) ? visitsRes : []);
      setSurveyors(Array.isArray(surveyorsRes) ? surveyorsRes : []);
    } catch (e) {
      showAlert('Failed to load: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadPhotos(visitId) {
    try {
      const data = await fetch(`/api/site-visits/${visitId}/photos`).then(r => r.json());
      setPhotosByVisit(prev => ({ ...prev, [visitId]: Array.isArray(data) ? data : [] }));
    } catch (e) {
      showAlert('Failed to load photos: ' + e.message, 'error');
    }
  }

  function showAlert(msg, type) {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  function openNew() {
    setEditId(null);
    setFormData({
      status: 'planned',
      conducted_by_name: user?.name || '',
      conducted_by_email: user?.email || '',
      attendees: [],
      company: claim?.company || 'NISLA',
    });
    setShowModal(true);
  }

  function openEdit(v) {
    setEditId(v.id);
    setFormData({
      ...v,
      attendees: v.attendees || [],
      scheduled_at: toLocalInput(v.scheduled_at),
      started_at: toLocalInput(v.started_at),
      completed_at: toLocalInput(v.completed_at),
    });
    setShowModal(true);
  }

  async function save() {
    try {
      const payload = {
        ...formData,
        claim_id: claimId,
        scheduled_at: fromLocalInput(formData.scheduled_at),
        started_at: fromLocalInput(formData.started_at),
        completed_at: fromLocalInput(formData.completed_at),
        attendees: typeof formData.attendees === 'string'
          ? formData.attendees.split(',').map(s => s.trim()).filter(Boolean)
          : (formData.attendees || []),
        created_by: user?.email || null,
      };
      delete payload.id;
      delete payload.created_at;
      delete payload.updated_at;

      const url = editId ? `/api/site-visits/${editId}` : '/api/site-visits';
      const method = editId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Save failed');
      }
      showAlert(editId ? 'Visit updated' : 'Visit created', 'success');
      setShowModal(false);
      await loadAll();
    } catch (e) {
      showAlert(e.message, 'error');
    }
  }

  async function deleteVisit(id) {
    if (!confirm('Delete this site visit and all its photos? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/site-visits/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      showAlert('Visit deleted', 'success');
      await loadAll();
    } catch (e) {
      showAlert(e.message, 'error');
    }
  }

  async function toggleVisit(visitId) {
    if (expandedVisit === visitId) {
      setExpandedVisit(null);
      return;
    }
    setExpandedVisit(visitId);
    if (!photosByVisit[visitId]) {
      await loadPhotos(visitId);
    }
  }

  function pickFile(visitId) {
    setUploadingFor(visitId);
    fileInputRef.current?.click();
  }

  async function onFilePicked(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !uploadingFor) return;
    const visitId = uploadingFor;
    setUploadingFor(null);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('uploaded_by_email', user?.email || '');
      fd.append('uploaded_by_name', user?.name || '');

      const res = await fetch(`/api/site-visits/${visitId}/photos`, { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }
      await loadPhotos(visitId);
      showAlert('Photo uploaded', 'success');
    } catch (e) {
      showAlert(e.message, 'error');
    }
  }

  async function deletePhoto(visitId, photoId) {
    if (!confirm('Delete this photo?')) return;
    try {
      const res = await fetch(`/api/site-visits/${visitId}/photos?photo_id=${photoId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      await loadPhotos(visitId);
    } catch (e) {
      showAlert(e.message, 'error');
    }
  }

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif,image/webp"
          style={{ display: 'none' }}
          onChange={onFilePicked}
        />

        <h2>Site Visits</h2>
        {claim ? (
          <p style={{ color: '#475569', fontSize: 13, marginTop: -8 }}>
            Claim <strong>{claim.ref_number}</strong> · {claim.insured_name || '—'} · {claim.lob}
          </p>
        ) : (
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: -8 }}>Claim ID {claimId}</p>
        )}

        <p style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
          IRDAI requires geotagged + timestamped photo evidence per site visit (CLAUDE.md §13). Photos missing GPS or timestamp are flagged.
        </p>

        <div className="button-group" style={{ marginTop: 16 }}>
          <button className="success" onClick={openNew}>+ New Site Visit</button>
        </div>

        {loading ? (
          <div className="loading">Loading site visits...</div>
        ) : visits.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            No site visits recorded yet — click "+ New Site Visit" to create one.
          </p>
        ) : (
          <div style={{ marginTop: 16 }}>
            {visits.map(v => (
              <VisitCard
                key={v.id}
                visit={v}
                expanded={expandedVisit === v.id}
                photos={photosByVisit[v.id] || []}
                onToggle={() => toggleVisit(v.id)}
                onEdit={() => openEdit(v)}
                onDelete={() => deleteVisit(v.id)}
                onUpload={() => pickFile(v.id)}
                onDeletePhoto={(pid) => deletePhoto(v.id, pid)}
              />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal show" onClick={e => e.target.className.includes('modal show') && setShowModal(false)}>
          <div className="modal-content wide">
            <span className="modal-close" onClick={() => setShowModal(false)}>&times;</span>
            <h3>{editId ? `Edit Site Visit #${formData.visit_number || ''}` : 'New Site Visit'}</h3>

            <div className="form-section">
              <h4>Schedule</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Status</label>
                  <select value={formData.status || 'planned'} onChange={e => setFormData({ ...formData, status: e.target.value })}>
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Purpose</label>
                  <input value={formData.purpose || ''} onChange={e => setFormData({ ...formData, purpose: e.target.value })} placeholder="e.g. First-look inspection, salvage assessment" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Scheduled at</label>
                  <input type="datetime-local" value={formData.scheduled_at || ''} onChange={e => setFormData({ ...formData, scheduled_at: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Started at</label>
                  <input type="datetime-local" value={formData.started_at || ''} onChange={e => setFormData({ ...formData, started_at: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Completed at</label>
                  <input type="datetime-local" value={formData.completed_at || ''} onChange={e => setFormData({ ...formData, completed_at: e.target.value })} />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h4>People</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Surveyor</label>
                  <select value={formData.surveyor_id || ''} onChange={e => setFormData({ ...formData, surveyor_id: e.target.value })}>
                    <option value="">— Select —</option>
                    {surveyors.map(s => (
                      <option key={s.id} value={s.id} disabled={s.license_status === 'expired'}>
                        {s.name}{s.license_status === 'expired' ? ' (license expired)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Conducted by</label>
                  <input value={formData.conducted_by_name || ''} onChange={e => setFormData({ ...formData, conducted_by_name: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Attendees (comma-separated)</label>
                <input
                  value={Array.isArray(formData.attendees) ? formData.attendees.join(', ') : (formData.attendees || '')}
                  onChange={e => setFormData({ ...formData, attendees: e.target.value })}
                  placeholder="Insured rep, dealer rep, witness, etc."
                />
              </div>
            </div>

            <div className="form-section">
              <h4>Location</h4>
              <div className="form-group">
                <label>Address</label>
                <textarea rows={2} value={formData.location_address || ''} onChange={e => setFormData({ ...formData, location_address: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>PIN</label>
                  <input value={formData.location_pin || ''} onChange={e => setFormData({ ...formData, location_pin: e.target.value })} maxLength={6} />
                </div>
                <div className="form-group">
                  <label>State</label>
                  <input value={formData.location_state || ''} onChange={e => setFormData({ ...formData, location_state: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>District</label>
                  <input value={formData.location_district || ''} onChange={e => setFormData({ ...formData, location_district: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Lat</label>
                  <input value={formData.location_lat || ''} onChange={e => setFormData({ ...formData, location_lat: e.target.value })} placeholder="19.076" />
                </div>
                <div className="form-group">
                  <label>Lng</label>
                  <input value={formData.location_lng || ''} onChange={e => setFormData({ ...formData, location_lng: e.target.value })} placeholder="72.877" />
                </div>
                <div className="form-group">
                  <label>Weather</label>
                  <input value={formData.weather_conditions || ''} onChange={e => setFormData({ ...formData, weather_conditions: e.target.value })} placeholder="Sunny / monsoon / etc." />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h4>Findings</h4>
              <div className="form-group">
                <label>Observations</label>
                <textarea rows={4} value={formData.observations || ''} onChange={e => setFormData({ ...formData, observations: e.target.value })} placeholder="Visual condition, scope of damage, points to verify, etc." />
              </div>
              <div className="form-group">
                <label>Next steps</label>
                <textarea rows={2} value={formData.next_steps || ''} onChange={e => setFormData({ ...formData, next_steps: e.target.value })} placeholder="Documents to collect, follow-up visit, lab tests, etc." />
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <button className="success" style={{ width: '100%' }} onClick={save}>{editId ? 'Update' : 'Create'}</button>
              <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

function VisitCard({ visit, expanded, photos, onToggle, onEdit, onDelete, onUpload, onDeletePhoto }) {
  const statusColors = {
    planned: { bg: '#dbeafe', color: '#1e40af' },
    in_progress: { bg: '#fef3c7', color: '#92400e' },
    completed: { bg: '#dcfce7', color: '#15803d' },
    cancelled: { bg: '#fee2e2', color: '#b91c1c' },
  }[visit.status] || { bg: '#f1f5f9', color: '#475569' };

  const evidentiary = photos.filter(p => p.has_geotag && p.has_timestamp).length;
  const flagged = photos.length - evidentiary;

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 12, background: '#fff' }}>
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>Visit #{visit.visit_number}</span>
            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: statusColors.bg, color: statusColors.color }}>
              {STATUS_LABEL[visit.status]}
            </span>
            {visit.purpose && <span style={{ fontSize: 13, color: '#475569' }}>{visit.purpose}</span>}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            {visit.scheduled_at && <>Scheduled: {formatDateTime(visit.scheduled_at)} · </>}
            {visit.location_address ? visit.location_address : 'No location'}
          </div>
        </div>
        <button className="secondary" onClick={onToggle} style={{ fontSize: 12 }}>
          {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
          {flagged > 0 && <span style={{ marginLeft: 6, color: '#b45309' }}>· {flagged} flagged</span>}
          {expanded ? ' ▲' : ' ▼'}
        </button>
        <button className="secondary" onClick={onEdit}>Edit</button>
        <button className="danger" onClick={onDelete}>Delete</button>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid #e2e8f0', padding: 16 }}>
          {visit.observations && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Observations</div>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{visit.observations}</div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Photo evidence</div>
            <button className="primary" onClick={onUpload} style={{ fontSize: 12 }}>+ Upload Photo</button>
          </div>

          {photos.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: 13, padding: '20px 0' }}>No photos uploaded yet.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {photos.map(p => (
                <PhotoCard key={p.id} photo={p} onDelete={() => onDeletePhoto(p.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PhotoCard({ photo, onDelete }) {
  const evidentiary = photo.has_geotag && photo.has_timestamp;
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden', background: '#f8fafc', position: 'relative' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.file_url}
        alt={photo.caption || photo.file_name}
        style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }}
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
      <div style={{ padding: '8px 10px' }}>
        <div style={{ fontSize: 11, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={photo.file_name}>
          {photo.file_name}
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
          <Tag ok={photo.has_geotag} okLabel="GPS" badLabel="No GPS" />
          <Tag ok={photo.has_timestamp} okLabel="Time" badLabel="No time" />
        </div>
        {photo.taken_at && (
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{formatDateTime(photo.taken_at)}</div>
        )}
        {photo.has_geotag && (
          <div style={{ fontSize: 10, color: '#64748b' }}>{photo.gps_lat?.toFixed(4)}, {photo.gps_lng?.toFixed(4)}</div>
        )}
        {!evidentiary && (
          <div style={{ fontSize: 10, color: '#b45309', marginTop: 4, fontWeight: 600 }}>
            ⚠ Not evidentiary
          </div>
        )}
        <button className="danger" onClick={onDelete} style={{ fontSize: 10, padding: '2px 6px', marginTop: 6 }}>Delete</button>
      </div>
    </div>
  );
}

function Tag({ ok, okLabel, badLabel }) {
  return (
    <span style={{
      padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
      background: ok ? '#dcfce7' : '#fee2e2',
      color: ok ? '#15803d' : '#b91c1c',
    }}>{ok ? okLabel : badLabel}</span>
  );
}

function formatDateTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

// Convert ISO timestamp → "yyyy-MM-ddTHH:mm" for <input type=datetime-local />
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

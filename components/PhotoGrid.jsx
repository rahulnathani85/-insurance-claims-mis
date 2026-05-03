'use client';
// =============================================================================
// components/PhotoGrid.jsx
// =============================================================================
// Slice 9 — site_visit_photos grid grouped by AI category, with
// red-flag badges + bulk-classify action.
//
// Reads from /api/site-visits/<visitId>/photos (per-visit) and rolls up
// into a single claim-level view. Separates classified / unclassified /
// failed photos so the surveyor knows what state each is in.
//
// Three buttons in the header:
//   ⚡ Classify all unclassified — POSTs to /api/ai/classify-photos
//                                  with the claim_id; reloads on done.
//   🔄 Reclassify selected      — same endpoint with photo_ids + reclassify=true.
//   📤 Re-classify failures      — only the classification_failed photos.
//
// Each photo card shows:
//   - The image (thumbnail via /api/file-proxy)
//   - Filename, file size, captured-at (from EXIF)
//   - Category badge (color-coded by category bucket)
//   - Confidence dot
//   - Flag chips (red — tampering, pre-existing damage, etc.)
//   - AI observations as caption underneath
//
// Props:
//   claimId       BIGINT  (required)
//   userEmail     string  for audit logging
//   refreshKey    any     bump from parent to force reload
//
// Note: Slice 9 only handles classification + display. Editing the
// AI's category / observations manually (override flow) is a Phase 2
// enhancement; the surveyor can flip is_annexure on/off and that's it
// for now.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';

const SEVERITY_FLAGS = new Set([
  'tampering_visible', 'pre_existing_damage', 'date_mismatch',
  'unclear_evidence', 'serial_mismatch',
]);

const CONFIDENCE_DOT = (c) => {
  if (typeof c !== 'number') return { bg: '#cbd5e1', label: '?' };
  if (c >= 0.85) return { bg: '#16a34a', label: 'High' };
  if (c >= 0.6)  return { bg: '#ca8a04', label: 'Med' };
  return { bg: '#dc2626', label: 'Low' };
};

export default function PhotoGrid({ claimId, userEmail, refreshKey }) {
  const [visits, setVisits] = useState([]);
  const [photosByVisit, setPhotosByVisit] = useState({});
  const [loading, setLoading] = useState(true);
  const [classifying, setClassifying] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // -- load visits + their photos --------------------------------------
  async function loadAll() {
    if (!claimId) return;
    setLoading(true);
    setError(null);
    try {
      const visitsRes = await fetch(`/api/site-visits?claim_id=${claimId}`);
      const visitsData = await visitsRes.json();
      const visitsList = Array.isArray(visitsData) ? visitsData : [];
      setVisits(visitsList);

      const photoMaps = await Promise.all(visitsList.map((v) =>
        fetch(`/api/site-visits/${v.id}/photos`).then(r => r.json()).catch(() => [])
      ));
      const out = {};
      visitsList.forEach((v, i) => { out[v.id] = Array.isArray(photoMaps[i]) ? photoMaps[i] : []; });
      setPhotosByVisit(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadAll(); }, [claimId, refreshKey]);

  // -- flatten photos for counts + grouping ----------------------------
  const allPhotos = useMemo(() => {
    const out = [];
    for (const v of visits) {
      for (const p of (photosByVisit[v.id] || [])) {
        out.push({ ...p, _visit: v });
      }
    }
    return out;
  }, [visits, photosByVisit]);

  const counts = useMemo(() => {
    const c = { unclassified: 0, classified: 0, failed: 0, total: allPhotos.length };
    for (const p of allPhotos) {
      const s = p.classification_status || 'unclassified';
      if (s === 'classified') c.classified++;
      else if (s === 'classification_failed') c.failed++;
      else c.unclassified++;
    }
    return c;
  }, [allPhotos]);

  const photosByCategory = useMemo(() => {
    const map = {};
    for (const p of allPhotos) {
      if (p.classification_status !== 'classified') continue;
      const k = p.category || 'OTHER';
      (map[k] = map[k] || []).push(p);
    }
    return map;
  }, [allPhotos]);

  const unclassified = useMemo(
    () => allPhotos.filter((p) => (p.classification_status || 'unclassified') === 'unclassified'),
    [allPhotos]
  );
  const failed = useMemo(
    () => allPhotos.filter((p) => p.classification_status === 'classification_failed'),
    [allPhotos]
  );

  // -- classification calls --------------------------------------------
  async function classifyAll() {
    if (counts.unclassified === 0) {
      setInfo('Nothing to classify — every photo is already classified or failed.');
      return;
    }
    setClassifying(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/ai/classify-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: claimId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || 'classify failed');
      setInfo(`Classified ${data.classified} photo(s) in ${data.batches} batch(es)${data.failed ? `, ${data.failed} failed` : ''}.`);
      await loadAll();
    } catch (e) {
      setError(e.message);
    } finally {
      setClassifying(false);
    }
  }

  async function classifySpecific(photoIds, { reclassify = false } = {}) {
    if (!photoIds.length) {
      setInfo('No photos selected.');
      return;
    }
    setClassifying(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/ai/classify-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_ids: photoIds, reclassify }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || 'classify failed');
      setInfo(`Classified ${data.classified}${data.failed ? `, ${data.failed} failed` : ''}.`);
      setSelectedIds(new Set());
      await loadAll();
    } catch (e) {
      setError(e.message);
    } finally {
      setClassifying(false);
    }
  }

  function toggleSelect(id) {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  // -- render ----------------------------------------------------------
  if (loading) return <div style={loadingStyle}>Loading photos…</div>;

  if (allPhotos.length === 0) {
    return (
      <div style={emptyStyle}>
        <div style={{ fontSize: 32 }}>📷</div>
        <p>No site-visit photos yet for this claim.</p>
        <p style={{ fontSize: 12, color: '#94a3b8' }}>
          Add photos via the <strong>Site Visits</strong> tab. They&rsquo;ll appear here once uploaded.
        </p>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <div style={headerStyle}>
        <div>
          <h4 style={titleStyle}>Photo Grid (AI-classified)</h4>
          <div style={subStyle}>
            <strong>{counts.total}</strong> total ·{' '}
            <span style={{ color: '#16a34a' }}>{counts.classified} classified</span> ·{' '}
            <span style={{ color: '#ca8a04' }}>{counts.unclassified} pending</span>
            {counts.failed > 0 && (
              <> · <span style={{ color: '#dc2626' }}>{counts.failed} failed</span></>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={classifyAll}
            disabled={classifying || counts.unclassified === 0}
            style={primaryBtn(classifying || counts.unclassified === 0)}
          >
            {classifying ? '⏳ Classifying…' : `⚡ Classify ${counts.unclassified || ''} unclassified`}
          </button>
          {counts.failed > 0 && (
            <button
              type="button"
              onClick={() => classifySpecific(failed.map((p) => p.id))}
              disabled={classifying}
              style={retryBtn(classifying)}
            >
              ↻ Retry {counts.failed} failed
            </button>
          )}
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => classifySpecific(Array.from(selectedIds), { reclassify: true })}
              disabled={classifying}
              style={reclassifyBtn(classifying)}
            >
              🔄 Reclassify {selectedIds.size}
            </button>
          )}
        </div>
      </div>

      {error && <div style={errBanner}>⚠ {error}</div>}
      {info && <div style={infoBanner}>{info}</div>}

      {/* Unclassified bucket */}
      {unclassified.length > 0 && (
        <Bucket title={`Pending classification (${unclassified.length})`} subtitle="Photos waiting for AI categorisation">
          <PhotoCards photos={unclassified} selectedIds={selectedIds} onToggle={toggleSelect} />
        </Bucket>
      )}

      {/* Failed bucket */}
      {failed.length > 0 && (
        <Bucket title={`Classification failed (${failed.length})`} tone="error">
          <PhotoCards photos={failed} selectedIds={selectedIds} onToggle={toggleSelect} />
        </Bucket>
      )}

      {/* Classified buckets, one per category */}
      {Object.keys(photosByCategory).sort().map((cat) => (
        <Bucket key={cat} title={`${cat} (${photosByCategory[cat].length})`}>
          <PhotoCards photos={photosByCategory[cat]} selectedIds={selectedIds} onToggle={toggleSelect} />
        </Bucket>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Bucket — section heading + body wrap
// -----------------------------------------------------------------------------
function Bucket({ title, subtitle, tone, children }) {
  return (
    <div style={bucketStyle(tone)}>
      <div style={bucketHeaderStyle}>
        <span style={bucketTitleStyle}>{title}</span>
        {subtitle && <span style={bucketSubtitleStyle}>{subtitle}</span>}
      </div>
      <div style={bucketBodyStyle}>{children}</div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// PhotoCards
// -----------------------------------------------------------------------------
function PhotoCards({ photos, selectedIds, onToggle }) {
  return (
    <div style={cardsGridStyle}>
      {photos.map((p) => (
        <PhotoCard key={p.id} photo={p} selected={selectedIds.has(p.id)} onToggle={() => onToggle(p.id)} />
      ))}
    </div>
  );
}

function PhotoCard({ photo, selected, onToggle }) {
  const flags = Array.isArray(photo.flags) ? photo.flags : [];
  const hasRedFlag = flags.some((f) => SEVERITY_FLAGS.has(f));
  const dot = CONFIDENCE_DOT(typeof photo.ai_confidence === 'number' ? photo.ai_confidence : null);
  const classified = photo.classification_status === 'classified';
  const failed = photo.classification_status === 'classification_failed';

  return (
    <div style={cardStyle({ selected, hasRedFlag, failed })}>
      <div style={imgWrapStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.file_url} alt={photo.file_name} style={imgStyle} loading="lazy" />
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          style={checkboxStyle}
          title="Select for reclassification"
        />
        {classified && (
          <span style={confidenceDotStyle(dot.bg)} title={`AI confidence: ${dot.label} (${(photo.ai_confidence ?? 0).toFixed(2)})`}>
            {dot.label}
          </span>
        )}
      </div>
      <div style={cardBodyStyle}>
        <div style={fileNameStyle} title={photo.file_name}>{photo.file_name}</div>
        <div style={metaStyle}>
          {photo.taken_at && <span>📷 {new Date(photo.taken_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
          {photo.has_geotag && <span title={`${photo.gps_lat}, ${photo.gps_lng}`}> · 📍</span>}
        </div>
        {classified && photo.ai_observations && (
          <div style={obsStyle}>{photo.ai_observations}</div>
        )}
        {failed && (
          <div style={failedStyle}>
            ⚠ {photo.ai_observations || 'classification failed'}
          </div>
        )}
        {flags.length > 0 && (
          <div style={flagsRowStyle}>
            {flags.map((f) => (
              <span key={f} style={flagChipStyle(SEVERITY_FLAGS.has(f))}>{f}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// styles
// -----------------------------------------------------------------------------

const wrapStyle = { display: 'flex', flexDirection: 'column', gap: 14 };

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  flexWrap: 'wrap', gap: 10,
  padding: 12, background: '#f8fafc',
  border: '1px solid #e2e8f0', borderRadius: 8,
};

const titleStyle = { margin: 0, fontSize: 14, fontWeight: 700, color: '#0f172a' };
const subStyle = { fontSize: 11, color: '#64748b', marginTop: 2 };

function primaryBtn(disabled) {
  return {
    padding: '6px 12px', fontSize: 12, fontWeight: 600,
    background: disabled ? '#94a3b8' : '#1e293b', color: '#fff',
    border: 'none', borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
  };
}
function retryBtn(disabled) {
  return {
    padding: '6px 12px', fontSize: 12, fontWeight: 600,
    background: disabled ? '#fca5a5' : '#dc2626', color: '#fff',
    border: 'none', borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
  };
}
function reclassifyBtn(disabled) {
  return {
    padding: '6px 12px', fontSize: 12, fontWeight: 600,
    background: disabled ? '#93c5fd' : '#2563eb', color: '#fff',
    border: 'none', borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
  };
}

const errBanner  = { padding: '8px 12px', background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12 };
const infoBanner = { padding: '8px 12px', background: '#dbeafe', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 12 };

const loadingStyle = { padding: 30, textAlign: 'center', color: '#64748b' };
const emptyStyle = { padding: 50, textAlign: 'center', color: '#64748b', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8 };

function bucketStyle(tone) {
  const border = tone === 'error' ? '#fecaca' : '#e2e8f0';
  const bg = tone === 'error' ? '#fef2f2' : '#fff';
  return {
    border: `1px solid ${border}`, borderRadius: 8, background: bg,
  };
}
const bucketHeaderStyle = {
  padding: '8px 12px', borderBottom: '1px solid #e2e8f0',
  background: '#fafbfc', borderTopLeftRadius: 8, borderTopRightRadius: 8,
  display: 'flex', alignItems: 'center', gap: 10,
};
const bucketTitleStyle = { fontSize: 12, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.3 };
const bucketSubtitleStyle = { fontSize: 11, color: '#64748b', fontStyle: 'italic' };
const bucketBodyStyle = { padding: 10 };

const cardsGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: 10,
};

function cardStyle({ selected, hasRedFlag, failed }) {
  const border = failed ? '#dc2626'
              : hasRedFlag ? '#dc2626'
              : selected ? '#2563eb'
              : '#e2e8f0';
  return {
    border: `2px solid ${border}`, borderRadius: 8,
    overflow: 'hidden', background: '#fff',
    display: 'flex', flexDirection: 'column',
  };
}

const imgWrapStyle = {
  position: 'relative', aspectRatio: '4 / 3',
  background: '#f1f5f9', overflow: 'hidden',
};
const imgStyle = { width: '100%', height: '100%', objectFit: 'cover' };
const checkboxStyle = {
  position: 'absolute', top: 6, left: 6, transform: 'scale(1.2)',
  cursor: 'pointer',
};
function confidenceDotStyle(bg) {
  return {
    position: 'absolute', top: 6, right: 6,
    padding: '2px 8px', fontSize: 10, fontWeight: 700,
    background: bg, color: '#fff',
    borderRadius: 9999,
  };
}

const cardBodyStyle = { padding: 8, display: 'flex', flexDirection: 'column', gap: 4 };
const fileNameStyle = {
  fontSize: 11, fontWeight: 600, color: '#0f172a',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
const metaStyle = { fontSize: 10, color: '#64748b' };
const obsStyle = { fontSize: 11, color: '#334155', lineHeight: 1.4 };
const failedStyle = { fontSize: 11, color: '#991b1b', fontStyle: 'italic' };

const flagsRowStyle = { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 };
function flagChipStyle(severe) {
  return {
    fontSize: 9, padding: '1px 6px', fontWeight: 600,
    background: severe ? '#fee2e2' : '#fef3c7',
    color: severe ? '#991b1b' : '#92400e',
    border: `1px solid ${severe ? '#fecaca' : '#fde68a'}`,
    borderRadius: 9999,
  };
}

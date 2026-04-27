'use client';

// ============================================================
// /communications/triage/[id]
// ------------------------------------------------------------
// Stage 3b — triage detail view. Reads one inbox_messages row,
// shows the full content + attachments, and lets the human pick
// one of 8 workflow tags OR dismiss the message.
//
// On submit:
//   - tag picked   → POST /api/communications/triage with action='classify'
//   - dismiss      → POST /api/communications/triage with action='dismiss'
//                    (optional reason)
//
// After successful submit, redirects back to /communications/triage.
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

export default function TriageDetailPage() {
  const router = useRouter();
  const params = useParams();
  const messageId = params?.id;
  const { user, loading } = useAuth();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // UI state
  const [selectedTag, setSelectedTag] = useState(null);
  const [mode, setMode] = useState('classify'); // 'classify' | 'dismiss'
  const [dismissReason, setDismissReason] = useState('');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const load = useCallback(async () => {
    if (!user?.email || !messageId) return;
    setError(null);
    try {
      const res = await fetch(`/api/communications/messages/${messageId}`, {
        headers: { 'x-app-user-email': user.email },
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (err) {
      setError(err.message);
    }
  }, [user?.email, messageId]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (busy) return;
    setError(null);

    let body;
    if (mode === 'classify') {
      if (!selectedTag) {
        setError('Pick a tag first, or switch to "Dismiss" mode.');
        return;
      }
      body = { message_id: messageId, action: 'classify', tag: selectedTag };
    } else {
      body = {
        message_id: messageId,
        action: 'dismiss',
        reason: dismissReason.trim() || null,
      };
    }

    setBusy(true);
    try {
      const res = await fetch('/api/communications/triage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-user-email': user.email,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      // Success — go back to the queue.
      router.push('/communications/triage');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (loading) {
    return <PageLayout><div style={{ padding: 24 }}>Loading…</div></PageLayout>;
  }
  if (!user) return null;

  if (error && !data) {
    return (
      <PageLayout>
        <div style={{ padding: 24, maxWidth: 760, margin: '0 auto' }}>
          <BackLink />
          <Banner kind="err">{error}</Banner>
        </div>
      </PageLayout>
    );
  }
  if (!data) {
    return (
      <PageLayout>
        <div style={{ padding: 24 }}>Loading message…</div>
      </PageLayout>
    );
  }

  const { message, attachments, classifications, tags } = data;
  const isReceived = message.status === 'received';
  const activeClassification = (classifications || []).find((c) => c.is_active);

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1100, margin: '0 auto' }}>
        <BackLink />

        <h2 style={{ margin: '8px 0 4px', fontSize: 22, color: '#1e293b' }}>
          {message.subject || '(no subject)'}
        </h2>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
          {message.company} · {new Date(message.received_at).toLocaleString()}
        </div>

        {error && <Banner kind="err">{error}</Banner>}

        {!isReceived && (
          <Banner kind="warn">
            This message has already been triaged (status: <code style={codeChip}>{message.status}</code>).
            {activeClassification && (
              <> Active tag: <code style={codeChip}>{activeClassification.tag}</code>.</>
            )}
            {' '}Triage actions are disabled below.
          </Banner>
        )}

        {/* Two-column layout: message content + triage actions */}
        <div style={{
          display: 'grid', gap: 18,
          gridTemplateColumns: 'minmax(0, 1fr) 360px',
          alignItems: 'start',
        }}>
          {/* LEFT: message content */}
          <div>
            <div style={cardStyle}>
              <SectionRow label="From" value={message.from_address} />
              <SectionRow label="To" value={message.to_address} />
              {message.cc_addresses?.length > 0 && (
                <SectionRow label="Cc" value={message.cc_addresses.join(', ')} />
              )}
              <SectionRow label="Source" value={message.source} />
              {message.thread_id && (
                <SectionRow label="Thread" value={message.thread_id} small />
              )}
            </div>

            <SectionTitle>Body</SectionTitle>
            <div style={{
              ...cardStyle,
              maxHeight: 480, overflowY: 'auto',
              whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.55,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              color: '#0f172a',
            }}>
              {message.body_plain || '(empty)'}
            </div>

            {attachments?.length > 0 && (
              <>
                <SectionTitle>Attachments ({attachments.length})</SectionTitle>
                <div style={cardStyle}>
                  {attachments.map((a) => (
                    <div key={a.id} style={{
                      display: 'flex', justifyContent: 'space-between',
                      padding: '6px 0', borderTop: '1px solid #f1f5f9',
                      fontSize: 12,
                    }}>
                      <span style={{ color: '#0f172a' }}>
                        {a.is_image ? '🖼️' : '📎'} {a.filename}
                      </span>
                      <span style={{ color: '#94a3b8' }}>
                        {a.mime_type} · {formatBytes(a.size_bytes)}
                      </span>
                    </div>
                  ))}
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
                    Stage 3c will run OCR on these and feed the text to the LLM
                    after triage.
                  </div>
                </div>
              </>
            )}
          </div>

          {/* RIGHT: triage actions */}
          <div>
            <div style={{
              ...cardStyle, padding: 14,
              opacity: isReceived ? 1 : 0.5,
              pointerEvents: isReceived ? 'auto' : 'none',
            }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <ModeButton
                  active={mode === 'classify'}
                  onClick={() => setMode('classify')}
                  label="Categorise"
                />
                <ModeButton
                  active={mode === 'dismiss'}
                  onClick={() => setMode('dismiss')}
                  label="Dismiss"
                />
              </div>

              {mode === 'classify' ? (
                <>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
                    Pick the category that best fits this message. Extraction-required
                    categories trigger AI extraction (Stage 3c) after you confirm.
                  </div>
                  <TagGroupSection
                    title="Extraction Required"
                    titleColor="#1e40af"
                    titleBg="#dbeafe"
                    borderColor="#bfdbfe"
                    tags={(tags || []).filter((t) => t.extraction_required !== false)}
                    selectedTag={selectedTag}
                    onSelect={setSelectedTag}
                  />
                  <TagGroupSection
                    title="No Extraction"
                    titleColor="#475569"
                    titleBg="#f1f5f9"
                    borderColor="#e2e8f0"
                    tags={(tags || []).filter((t) => t.extraction_required === false)}
                    selectedTag={selectedTag}
                    onSelect={setSelectedTag}
                  />
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                    Mark this as not relevant. AI never runs on dismissed
                    messages.
                  </div>
                  <textarea
                    value={dismissReason}
                    onChange={(e) => setDismissReason(e.target.value)}
                    placeholder="(optional) Why is this not relevant?"
                    rows={3}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: 8, fontSize: 13,
                      border: '1px solid #cbd5e1', borderRadius: 6,
                      fontFamily: 'inherit',
                    }}
                  />
                </>
              )}

              <button
                onClick={submit}
                disabled={busy || !isReceived || (mode === 'classify' && !selectedTag)}
                style={{
                  marginTop: 12, width: '100%',
                  padding: '10px 12px', fontSize: 14, fontWeight: 700,
                  background: mode === 'classify' ? '#1e3a5f' : '#dc2626',
                  color: '#fff', border: 'none', borderRadius: 6,
                  cursor: busy ? 'wait' : 'pointer',
                  opacity: busy || !isReceived || (mode === 'classify' && !selectedTag) ? 0.5 : 1,
                }}
              >
                {busy
                  ? 'Submitting…'
                  : mode === 'classify'
                  ? `Confirm tag${selectedTag ? `: ${tagLabel(tags, selectedTag)}` : ''}`
                  : 'Dismiss as not relevant'}
              </button>
            </div>

            {classifications?.length > 0 && (
              <>
                <SectionTitle>Classification history</SectionTitle>
                <div style={cardStyle}>
                  {classifications.map((c) => (
                    <div key={c.id} style={{
                      borderTop: '1px solid #f1f5f9', padding: '6px 0',
                      fontSize: 12, lineHeight: 1.5,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 600, color: '#0f172a' }}>
                          {c.tag} {c.is_active && <span style={{ color: '#059669' }}>(active)</span>}
                        </span>
                        <span style={{ color: '#94a3b8' }}>
                          {new Date(c.classified_at).toLocaleString()}
                        </span>
                      </div>
                      <div style={{ color: '#64748b' }}>
                        by {c.classified_by} · model {c.classifier_model} · conf {c.confidence}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

// ------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------
function BackLink() {
  return (
    <Link
      href="/communications/triage"
      style={{
        fontSize: 12, color: '#1e3a5f', textDecoration: 'none',
        display: 'inline-block', marginBottom: 8,
      }}
    >← Back to triage queue</Link>
  );
}

function SectionTitle({ children }) {
  return (
    <h3 style={{
      margin: '18px 0 6px', fontSize: 11, color: '#475569',
      textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700,
    }}>{children}</h3>
  );
}

function SectionRow({ label, value, small }) {
  if (!value) return null;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '90px 1fr',
      gap: 10, padding: '4px 0', fontSize: small ? 11 : 13,
      borderBottom: '1px solid #f1f5f9',
    }}>
      <span style={{ color: '#64748b', fontWeight: 500 }}>{label}</span>
      <span style={{
        color: '#0f172a',
        wordBreak: 'break-word', fontFamily: small ? 'ui-monospace, monospace' : 'inherit',
      }}>{value}</span>
    </div>
  );
}

function ModeButton({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '6px 10px', fontSize: 12, fontWeight: 600,
        background: active ? '#1e3a5f' : '#f1f5f9',
        color: active ? '#fff' : '#475569',
        border: 'none', borderRadius: 6, cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function TagGroupSection({ title, titleColor, titleBg, borderColor, tags, selectedTag, onSelect }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div style={{
      marginBottom: 14,
      border: `2px solid ${borderColor}`,
      borderRadius: 8,
      overflow: 'hidden',
      background: '#fff',
    }}>
      {/* Section header — full-width banner */}
      <div style={{
        background: titleBg,
        color: titleColor,
        padding: '8px 12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: `2px solid ${borderColor}`,
      }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }}>
          {title}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 700,
          background: '#fff', color: titleColor,
          padding: '1px 8px', borderRadius: 999,
        }}>
          {tags.length} {tags.length === 1 ? 'category' : 'categories'}
        </span>
      </div>
      {/* Tag rows */}
      <div style={{ padding: 8, display: 'grid', gap: 5 }}>
        {tags.map((t) => (
          <TagButton key={t.tag} tag={t} selected={selectedTag === t.tag} onSelect={() => onSelect(t.tag)} />
        ))}
      </div>
    </div>
  );
}

function TagButton({ tag, selected, onSelect }) {
  const [showGuide, setShowGuide] = useState(false);
  const isExtraction = tag.extraction_required !== false;
  const selBg = isExtraction ? '#1e3a5f' : '#475569';

  return (
    <div style={{
      border: `2px solid ${selected ? selBg : '#e2e8f0'}`,
      borderRadius: 6, background: selected ? selBg : '#fff',
      cursor: 'pointer', transition: 'border-color 0.1s',
    }}>
      <div
        style={{ padding: '7px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}
        onClick={onSelect}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 12, color: selected ? '#fff' : '#0f172a' }}>
            {tag.display_label}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setShowGuide((p) => !p); }}
          style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 4, border: 'none',
            background: selected ? 'rgba(255,255,255,0.2)' : '#f1f5f9',
            color: selected ? '#fff' : '#64748b', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          {showGuide ? 'Hide guide' : 'Guide'}
        </button>
      </div>
      {showGuide && (
        <div style={{
          padding: '0 10px 8px', fontSize: 11, color: selected ? 'rgba(255,255,255,0.85)' : '#374151',
          lineHeight: 1.5, borderTop: `1px solid ${selected ? 'rgba(255,255,255,0.15)' : '#f1f5f9'}`,
          paddingTop: 6,
        }}>
          {tag.guidance || tag.description || 'No guidance available for this category.'}
        </div>
      )}
    </div>
  );
}

function tagLabel(tags, tag) {
  const t = (tags || []).find((x) => x.tag === tag);
  return t?.display_label || tag;
}

function Banner({ kind, children }) {
  const map = {
    ok:   { bg: '#ecfdf5', fg: '#065f46', bd: '#a7f3d0' },
    warn: { bg: '#fffbeb', fg: '#92400e', bd: '#fde68a' },
    err:  { bg: '#fef2f2', fg: '#991b1b', bd: '#fecaca' },
  };
  const c = map[kind] || map.warn;
  return (
    <div style={{
      background: c.bg, color: c.fg, border: `1px solid ${c.bd}`,
      padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function formatBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const cardStyle = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: 12,
  boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
};

const codeChip = {
  background: '#f1f5f9',
  padding: '1px 5px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#0f172a',
};

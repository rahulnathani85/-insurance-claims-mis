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

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import { useMediaQuery, MOBILE_BREAKPOINT } from '@/lib/useMediaQuery';

export default function TriageDetailPage() {
  const router = useRouter();
  const params = useParams();
  const messageId = params?.id;
  const { user, loading } = useAuth();
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT);

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // UI state
  const [selectedTag, setSelectedTag] = useState(null);
  const [mode, setMode] = useState('classify'); // 'classify' | 'dismiss'
  const [dismissReason, setDismissReason] = useState('');
  // Attachment preview modal — null when closed, otherwise the
  // attachment object that should be rendered in the lightbox.
  const [previewAttachment, setPreviewAttachment] = useState(null);

  useEffect(() => {
    if (!previewAttachment) return;
    const onKey = (e) => { if (e.key === 'Escape') setPreviewAttachment(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewAttachment]);

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

  const { message, attachments, classifications, tags, drafts } = data;
  const isReceived = message.status === 'received';
  const activeClassification = (classifications || []).find((c) => c.is_active);

  return (
    <PageLayout>
      <div style={{ padding: isMobile ? '12px 14px' : '20px 24px', maxWidth: 1100, margin: '0 auto' }}>
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

        {/* Two-column layout: message content + triage actions
            On mobile: single column stack so triage actions appear after the body */}
        <div style={{
          display: 'grid', gap: 18,
          gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) 360px',
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

            {/* Attachments BEFORE body — easier to find. */}
            <SectionTitle>
              Attachments ({attachments?.length || 0})
              {message.attachments_count > (attachments?.length || 0) && (
                <span style={{ marginLeft: 8, fontSize: 10, color: '#b45309', background: '#fef3c7', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                  Gmail reported {message.attachments_count}
                </span>
              )}
            </SectionTitle>
            <AttachmentsBlock
              attachments={attachments}
              gmailCount={message.attachments_count}
              messageId={message.id}
              userEmail={user.email}
              userRole={user.role}
              onReprocessed={load}
              onPreview={setPreviewAttachment}
            />

            <BodyViewer message={message} />

            {drafts && drafts.filter((d) => d.status !== 'discarded').length > 0 && (
              <>
                <SectionTitle>AI Reply Drafts ({drafts.filter((d) => d.status !== 'discarded').length})</SectionTitle>
                {drafts.filter((d) => d.status !== 'discarded').map((draft) => (
                  <DraftCard key={draft.id} draft={draft} userEmail={user.email} onUpdate={load} />
                ))}
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
      {previewAttachment && (
        <AttachmentPreviewModal
          attachment={previewAttachment}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
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

function DraftCard({ draft, userEmail, onUpdate }) {
  const [editedBody, setEditedBody] = useState(draft.body_edited || draft.body);
  const [editedSubject, setEditedSubject] = useState(draft.subject);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isSent = draft.status === 'sent';

  async function patch(updates) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/communications/drafts/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-app-user-email': userEmail },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      if (onUpdate) await onUpdate();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!confirm('Discard this draft?')) return;
    await patch({ status: 'discarded' });
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(`To: ${draft.to_address}\nSubject: ${editedSubject}\n\n${editedBody}`);
      alert('Copied to clipboard. Paste into Gmail to send.');
    } catch (err) {
      alert('Copy failed: ' + err.message);
    }
  }

  return (
    <div style={{
      ...cardStyle, marginBottom: 10,
      borderLeft: `4px solid ${isSent ? '#10b981' : '#7c3aed'}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
        <div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
            background: isSent ? '#dcfce7' : '#ede9fe',
            color: isSent ? '#166534' : '#5b21b6',
          }}>
            {isSent ? '✓ SENT' : 'AI DRAFT'}
          </span>
          {draft.llm_provider && (
            <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8' }}>
              {draft.llm_provider}
              {draft.llm_cost_inr ? ` · ₹${Number(draft.llm_cost_inr).toFixed(4)}` : ''}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>
          {new Date(draft.created_at).toLocaleString('en-IN')}
        </span>
      </div>

      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>
        <strong>To:</strong> {draft.to_address}
      </div>

      {isSent ? (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>{editedSubject}</div>
          <div style={{ fontSize: 12, color: '#374151', whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.5, padding: '8px 0' }}>
            {editedBody}
          </div>
          <div style={{ fontSize: 11, color: '#65a30d', marginTop: 6 }}>
            Sent {draft.sent_at ? new Date(draft.sent_at).toLocaleString('en-IN') : ''} by {draft.sent_by}
          </div>
        </>
      ) : (
        <>
          <input
            type="text" value={editedSubject}
            onChange={(e) => setEditedSubject(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '6px 10px',
              fontSize: 13, fontWeight: 600, border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 6,
            }}
            disabled={busy}
          />
          <textarea
            value={editedBody}
            onChange={(e) => setEditedBody(e.target.value)}
            rows={Math.min(Math.max(editedBody.split('\n').length, 6), 18)}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '8px 10px',
              fontSize: 12, lineHeight: 1.5, fontFamily: 'inherit',
              border: '1px solid #e2e8f0', borderRadius: 6, resize: 'vertical',
            }}
            disabled={busy}
          />
          {error && (
            <div style={{ fontSize: 12, color: '#991b1b', marginTop: 6 }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => patch({ subject: editedSubject, body_edited: editedBody })}
              disabled={busy || (editedBody === (draft.body_edited || draft.body) && editedSubject === draft.subject)}
              style={btn('secondary', busy)}
            >
              Save edits
            </button>
            <button onClick={copyToClipboard} disabled={busy} style={btn('secondary', busy)}>
              Copy to clipboard
            </button>
            <button
              onClick={() => patch({ subject: editedSubject, body_edited: editedBody, status: 'sent' })}
              disabled={busy}
              style={btn('primary', busy)}
            >
              Mark as sent
            </button>
            <button onClick={discard} disabled={busy} style={btn('danger', busy)}>
              Discard
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function btn(variant, disabled) {
  const base = { padding: '5px 12px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 };
  if (variant === 'primary') return { ...base, background: '#1e3a5f', color: '#fff' };
  if (variant === 'danger') return { ...base, background: '#fef2f2', color: '#991b1b' };
  return { ...base, background: '#f1f5f9', color: '#0f172a' };
}

function AttachmentsBlock({ attachments, gmailCount, messageId, userEmail, userRole, onReprocessed, onPreview }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const isAdmin = ['admin', 'super_admin'].includes(String(userRole || '').toLowerCase());
  const storedCount = attachments?.length || 0;
  const missingAttachments = (gmailCount || 0) > storedCount;

  async function reprocess() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/communications/messages/${messageId}/reprocess-attachments`, {
        method: 'POST',
        headers: { 'x-app-user-email': userEmail },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResult(json);
      // Refresh the page data so the attachments show up.
      if (onReprocessed) await onReprocessed();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={cardStyle}>
      {storedCount > 0 ? (
        <>
          {attachments.map((a) => (
            <AttachmentRow key={a.id} attachment={a} onPreview={onPreview} />
          ))}
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
            Click any attachment to preview it here. Inline (cid:) images in
            the email body won&apos;t render — open them from this list.
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', padding: '4px 0' }}>
          No file attachments on this email.
        </div>
      )}

      {/* Admin recovery: re-fetch from Gmail when stored < reported */}
      {isAdmin && missingAttachments && (
        <div style={{
          marginTop: 12, paddingTop: 10, borderTop: '1px solid #f1f5f9',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 11, color: '#92400e', flex: '1 1 auto' }}>
            <strong>Mismatch:</strong> Gmail reported {gmailCount} attachments but only {storedCount} are stored.
            Likely a transient ingest error.
          </div>
          <button
            onClick={reprocess}
            disabled={busy}
            style={{
              padding: '5px 12px', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 6,
              background: busy ? '#cbd5e1' : '#1e3a5f', color: '#fff',
              cursor: busy ? 'wait' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {busy ? 'Re-fetching…' : 'Reprocess from Gmail'}
          </button>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#991b1b', background: '#fef2f2', padding: '6px 10px', borderRadius: 6 }}>
          {error}
        </div>
      )}
      {result && (
        <div style={{
          marginTop: 8, fontSize: 12, padding: '8px 10px', borderRadius: 6,
          color: result.failed > 0 ? '#92400e' : '#065f46',
          background: result.failed > 0 ? '#fffbeb' : '#ecfdf5',
        }}>
          <div style={{ fontWeight: 700 }}>
            Recovered {result.new_count} of {result.gmail_reported} attachments
            {result.failed > 0 && ` — ${result.failed} failed`}.
          </div>
          {result.failures_by_stage && Object.keys(result.failures_by_stage).length > 0 && (
            <div style={{ marginTop: 6, fontSize: 11 }}>
              {Object.entries(result.failures_by_stage).map(([stage, items]) => (
                <div key={stage} style={{ marginTop: 4 }}>
                  <strong>{stage}</strong> ({items.length}):
                  <div style={{ marginLeft: 8, color: '#78716c', fontFamily: 'ui-monospace, monospace' }}>
                    {items.slice(0, 3).map((it, i) => (
                      <div key={i}>• {it.filename}: {it.error}</div>
                    ))}
                    {items.length > 3 && <div>… and {items.length - 3} more with same error</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BodyViewer({ message }) {
  const hasHtml = !!(message.body_html && message.body_html.trim());
  const hasPlain = !!(message.body_plain && message.body_plain.trim());
  const [view, setView] = useState(hasHtml ? 'html' : 'plain');
  const iframeRef = useRef(null);
  const [iframeHeight, setIframeHeight] = useState(400);

  // Auto-resize iframe to fit its content so the page scrolls naturally
  // (no double scrollbar fighting with the page).
  function handleIframeLoad() {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) return;
      // Add a CSS rule that hides broken images (cid: refs that don't resolve).
      const style = doc.createElement('style');
      style.textContent = `
        body { margin: 12px; font-family: -apple-system, system-ui, sans-serif; }
        img { max-width: 100%; height: auto; }
        img[src^="cid:"] { display: none; }
      `;
      doc.head.appendChild(style);
      // Measure body and resize iframe.
      const h = Math.max(doc.body.scrollHeight + 24, 200);
      setIframeHeight(h);
    } catch {
      // Cross-origin or sandbox restriction — fall back to fixed height.
    }
  }

  return (
    <>
      <div style={{
        margin: '18px 0 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <h3 style={{
          margin: 0, fontSize: 11, color: '#475569',
          textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700,
        }}>Body</h3>
        {hasHtml && hasPlain && (
          <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', padding: 2, borderRadius: 6 }}>
            <button onClick={() => setView('html')} style={viewToggleStyle(view === 'html')}>Rich (HTML)</button>
            <button onClick={() => setView('plain')} style={viewToggleStyle(view === 'plain')}>Plain</button>
          </div>
        )}
      </div>

      {view === 'html' && hasHtml ? (
        <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
          <iframe
            ref={iframeRef}
            srcDoc={message.body_html}
            sandbox="allow-same-origin allow-popups"
            onLoad={handleIframeLoad}
            style={{
              width: '100%', height: iframeHeight, border: 'none',
              background: '#fff', display: 'block',
            }}
            title="Email body"
          />
        </div>
      ) : (
        <div style={{
          ...cardStyle,
          whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.55,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          color: '#0f172a',
        }}>
          {message.body_plain || (hasHtml ? '(plain-text version not available — switch to Rich)' : '(empty)')}
        </div>
      )}
    </>
  );
}

function AttachmentRow({ attachment: a, onPreview }) {
  const isImage = a.is_image || a.mime_type?.startsWith('image/');
  const isPdf = a.mime_type === 'application/pdf' || a.filename?.toLowerCase().endsWith('.pdf');
  const icon = isImage ? '🖼️' : isPdf ? '📄' : '📎';
  const clickable = !!a.download_url;

  const content = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 0', borderTop: '1px solid #f1f5f9',
      fontSize: 12,
    }}>
      {isImage && a.download_url ? (
        <img
          src={a.download_url}
          alt={a.filename}
          style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, border: '1px solid #e2e8f0', background: '#f8fafc' }}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      ) : (
        <span style={{
          width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4,
        }}>{icon}</span>
      )}
      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <div style={{
          color: clickable ? '#1d4ed8' : '#0f172a',
          fontWeight: 600,
          textDecoration: clickable ? 'underline' : 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {a.filename}
        </div>
        <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 1 }}>
          {a.mime_type} · {formatBytes(a.size_bytes)}
        </div>
      </div>
      {clickable && (
        <span style={{ fontSize: 11, color: '#0ea5e9', whiteSpace: 'nowrap' }}>Preview ›</span>
      )}
    </div>
  );

  if (!clickable) return content;
  return (
    <button
      type="button"
      onClick={() => onPreview?.(a)}
      style={{
        all: 'unset',
        cursor: 'pointer', display: 'block', width: '100%',
      }}
    >
      {content}
    </button>
  );
}

// In-portal lightbox/modal for image and PDF attachments. Falls back
// to a download link for any other mime type. Closes on backdrop
// click, the close button, or the Escape key (handler in the page).
function AttachmentPreviewModal({ attachment: a, onClose }) {
  const isImage = a.is_image || a.mime_type?.startsWith('image/');
  const isPdf = a.mime_type === 'application/pdf' || a.filename?.toLowerCase().endsWith('.pdf');

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,23,42,0.78)',
        display: 'flex', flexDirection: 'column',
        padding: 20,
      }}
    >
      {/* Header */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          color: '#fff', marginBottom: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {a.filename}
          </div>
          <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
            {a.mime_type} · {formatBytes(a.size_bytes)}
          </div>
        </div>
        <a
          href={a.download_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 12, fontWeight: 600, color: '#fff',
            background: 'rgba(255,255,255,0.18)', padding: '6px 12px',
            borderRadius: 6, textDecoration: 'none',
          }}
        >
          Open in new tab ↗
        </a>
        <button
          type="button"
          onClick={onClose}
          style={{
            border: 'none', background: 'rgba(255,255,255,0.18)', color: '#fff',
            padding: '6px 12px', borderRadius: 6, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Close ✕
        </button>
      </div>

      {/* Body */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1, minHeight: 0,
          background: '#fff', borderRadius: 8, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {isImage ? (
          <img
            src={a.download_url}
            alt={a.filename}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : isPdf ? (
          <iframe
            src={a.download_url}
            title={a.filename}
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        ) : (
          <div style={{ padding: 32, textAlign: 'center', color: '#475569' }}>
            <div style={{ fontSize: 14, marginBottom: 12 }}>
              In-portal preview is not available for <strong>{a.mime_type || 'this file type'}</strong>.
            </div>
            <a
              href={a.download_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 13, fontWeight: 600, color: '#fff', background: '#1e3a5f',
                padding: '8px 16px', borderRadius: 6, textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Download / Open externally
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function viewToggleStyle(active) {
  return {
    padding: '3px 10px', fontSize: 11, fontWeight: 600,
    border: 'none', borderRadius: 4,
    background: active ? '#fff' : 'transparent',
    color: active ? '#0f172a' : '#64748b',
    cursor: 'pointer',
    boxShadow: active ? '0 1px 2px rgba(15,23,42,0.06)' : 'none',
  };
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

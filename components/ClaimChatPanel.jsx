'use client';
// =============================================================================
// components/ClaimChatPanel.jsx
// =============================================================================
// Slice 7 — per-claim AI co-pilot chat panel.
//
// Drops into the claim-detail page as a tab. Surveyor types a message,
// /api/ai/claim-chat responds with a reply + optional structured
// proposedChanges, the surveyor accepts or rejects each change. Accepted
// changes route through /api/ai/claim-chat/apply which writes via
// dualWrite (field), claim_fsr_drafts.narrative_jsonb (narrative),
// or marine_loss_sheets / loss_sheets (computation).
//
// Props:
//   claimId      BIGINT       (required)
//   userEmail    string       attached to user-role messages
//   userName     string       optional display name
//   onApplied()  fn           called after any proposed change is
//                             applied so the parent can refresh
//                             whichever screen the change touched
//                             (e.g. the FSR render panel).
// =============================================================================

import { useEffect, useRef, useState } from 'react';

export default function ClaimChatPanel({ claimId, userEmail, userName, onApplied }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingApply, setPendingApply] = useState(null);  // `${msgId}:${idx}` while applying
  const scrollRef = useRef(null);

  // -- initial history load ----------------------------------------------
  useEffect(() => {
    if (!claimId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/ai/claim-chat?claim_id=${claimId}`);
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(data?.error || 'history load failed');
        setMessages(Array.isArray(data) ? data : []);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [claimId]);

  // -- auto-scroll on new messages ---------------------------------------
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  async function send(e) {
    e?.preventDefault?.();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    setInput('');

    // Optimistic add of the user message so the UI feels snappy. We
    // replace it with the server's persisted version once the call
    // returns.
    const optimistic = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
      _optimistic: true,
    };
    setMessages((m) => [...m, optimistic]);

    try {
      const res = await fetch('/api/ai/claim-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claim_id: claimId,
          message: text,
          user_email: userEmail || null,
          user_name: userName || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        // Drop the optimistic; show error.
        setMessages((m) => m.filter((x) => x.id !== optimistic.id));
        if (data?.user_message) {
          // Server saved the user message but AI failed; restore it from server
          setMessages((m) => [...m, data.user_message]);
        }
        throw new Error(data?.error || 'AI call failed');
      }
      // Replace optimistic + append assistant reply
      setMessages((m) => [
        ...m.filter((x) => x.id !== optimistic.id),
        data.user_message,
        data.assistant_message,
      ]);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  async function decide(messageId, changeIndex, decision) {
    const k = `${messageId}:${changeIndex}`;
    setPendingApply(k);
    setError(null);
    try {
      const res = await fetch('/api/ai/claim-chat/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: messageId,
          change_index: changeIndex,
          decision,
          user_email: userEmail || null,
        }),
      });
      const data = await res.json();
      // Even on error the server logs the apply attempt with the error
      // string — refresh history so the panel reflects what happened.
      const histRes = await fetch(`/api/ai/claim-chat?claim_id=${claimId}`);
      const hist = await histRes.json();
      if (Array.isArray(hist)) setMessages(hist);

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'apply failed');
      }
      if (decision === 'accepted') onApplied?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setPendingApply(null);
    }
  }

  return (
    <div style={wrapStyle}>
      <div style={headerStyle}>
        <h4 style={titleStyle}>AI Co-pilot</h4>
        <span style={subtitleStyle}>
          Ask about policy interpretation, IRDAI compliance, computation methodology. Suggested changes
          appear as accept/reject cards under each reply.
        </span>
      </div>

      <div ref={scrollRef} style={messageListStyle}>
        {loading && <div style={loadingStyle}>Loading conversation…</div>}

        {!loading && messages.length === 0 && (
          <div style={emptyStyle}>
            <div style={{ fontSize: 28 }}>💬</div>
            <p style={{ margin: '6px 0' }}>No conversation yet. Try one of:</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {[
                'Is the loss admissible under this policy?',
                'Rephrase the situation of loss section more formally.',
                'What ICC clause should this Marine claim fall under?',
                'Is the computation arithmetic correct?',
              ].map((s) => (
                <button key={s} type="button" onClick={() => setInput(s)} style={suggestionChipStyle}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            pendingApply={pendingApply}
            onAccept={(idx) => decide(m.id, idx, 'accepted')}
            onReject={(idx) => decide(m.id, idx, 'rejected')}
          />
        ))}

        {sending && (
          <div style={typingStyle}>
            <span>AI is thinking</span><span style={{ animation: 'dots 1.4s infinite' }}>…</span>
          </div>
        )}
      </div>

      {error && <div style={errorBannerStyle}>⚠ {error}</div>}

      <form onSubmit={send} style={composerStyle}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e);
          }}
          placeholder="Ask the AI about this claim. Cmd/Ctrl + Enter to send."
          rows={3}
          disabled={sending}
          style={textareaStyle(sending)}
        />
        <div style={composerActionsStyle}>
          <span style={composerHintStyle}>
            {sending ? 'Waiting on AI…' : 'Cmd/Ctrl + Enter to send'}
          </span>
          <button type="submit" disabled={!input.trim() || sending} style={sendBtnStyle(!input.trim() || sending)}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}

// -----------------------------------------------------------------------------
// MessageRow
// -----------------------------------------------------------------------------
function MessageRow({ message, pendingApply, onAccept, onReject }) {
  const isUser = message.role === 'user';
  const proposed = Array.isArray(message.proposed_changes) ? message.proposed_changes : [];
  const applied = Array.isArray(message.applied_changes) ? message.applied_changes : [];
  const appliedByIndex = Object.fromEntries(applied.map((a) => [a.index, a]));

  return (
    <div style={messageRowStyle(isUser)}>
      <div style={messageBubbleStyle(isUser)}>
        <div style={messageHeaderStyle(isUser)}>
          <span style={{ fontSize: 11, fontWeight: 600 }}>
            {isUser ? (message.user_name || message.user_email || 'You') : '🤖 AI Co-pilot'}
          </span>
          <span style={{ fontSize: 10, color: isUser ? 'rgba(255,255,255,0.7)' : '#94a3b8' }}>
            {new Date(message.created_at).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
            {message.ai_provider && ` · ${message.ai_provider}`}
          </span>
        </div>
        <div style={messageBodyStyle(isUser)}>{message.content}</div>
      </div>

      {!isUser && proposed.length > 0 && (
        <div style={proposedChangesWrapStyle}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
            🧩 {proposed.length} proposed change{proposed.length === 1 ? '' : 's'}:
          </div>
          {proposed.map((c, idx) => (
            <ProposedChangeCard
              key={idx}
              change={c}
              index={idx}
              applied={appliedByIndex[idx]}
              busy={pendingApply === `${message.id}:${idx}`}
              onAccept={() => onAccept(idx)}
              onReject={() => onReject(idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// ProposedChangeCard
// -----------------------------------------------------------------------------
function ProposedChangeCard({ change, index, applied, busy, onAccept, onReject }) {
  const status = applied?.status;  // 'accepted' | 'rejected' | 'accepted_failed' | undefined
  const target = change.type === 'field'      ? `field · ${change.path}`
              : change.type === 'narrative'   ? `narrative · ${change.section}`
              : change.type === 'computation' ? `computation · ${change.path}`
              : change.type === 'annexure'    ? `annexure · ${change.section || ''}`
              : change.type;

  return (
    <div style={changeCardStyle(status)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={changeTargetStyle}>#{index + 1} · {target}</span>
        <ChangeStatusBadge status={status} error={applied?.error} />
      </div>
      <div style={changeReasonStyle}>{change.reason || '(no reason)'}</div>

      <div style={changeValuesStyle}>
        <div>
          <div style={changeValuesLabelStyle}>Current</div>
          <div style={changeValuesBodyStyle('#fef9c3', '#854d0e')}>
            {fmtValue(change.currentValue)}
          </div>
        </div>
        <div style={changeArrowStyle}>→</div>
        <div>
          <div style={changeValuesLabelStyle}>Proposed</div>
          <div style={changeValuesBodyStyle('#dcfce7', '#166534')}>
            {fmtValue(change.newValue)}
          </div>
        </div>
      </div>

      {!status && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onReject} disabled={busy} style={rejectBtnStyle(busy)}>
            Reject
          </button>
          <button type="button" onClick={onAccept} disabled={busy} style={acceptBtnStyle(busy)}>
            {busy ? 'Applying…' : '✓ Accept'}
          </button>
        </div>
      )}

      {status === 'accepted_failed' && (
        <div style={changeErrorStyle}>
          ⚠ Apply failed: {applied?.error || 'unknown error'}
        </div>
      )}
    </div>
  );
}

function ChangeStatusBadge({ status, error }) {
  if (!status) return null;
  const map = {
    accepted:        { bg: '#dcfce7', color: '#166534', label: '✓ Accepted' },
    rejected:        { bg: '#fee2e2', color: '#991b1b', label: '✕ Rejected' },
    accepted_failed: { bg: '#fef3c7', color: '#92400e', label: '⚠ Apply failed' },
  };
  const s = map[status];
  if (!s) return null;
  return (
    <span title={error || ''} style={{
      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      background: s.bg, color: s.color,
    }}>
      {s.label}
    </span>
  );
}

function fmtValue(v) {
  if (v === null || v === undefined) return <em style={{ color: '#94a3b8' }}>(none)</em>;
  if (typeof v === 'object') return <code>{JSON.stringify(v)}</code>;
  return String(v);
}

// -----------------------------------------------------------------------------
// styles
// -----------------------------------------------------------------------------

const wrapStyle = {
  display: 'flex', flexDirection: 'column',
  height: 'calc(100vh - 280px)', minHeight: 480,
  border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff',
};

const headerStyle = {
  padding: '10px 14px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc',
  borderTopLeftRadius: 10, borderTopRightRadius: 10,
};

const titleStyle = { margin: 0, fontSize: 14, fontWeight: 700, color: '#0f172a' };
const subtitleStyle = { fontSize: 11, color: '#64748b' };

const messageListStyle = {
  flex: 1, overflowY: 'auto', padding: 14,
  display: 'flex', flexDirection: 'column', gap: 10,
};

const loadingStyle = { padding: 30, textAlign: 'center', color: '#64748b', fontSize: 12 };
const emptyStyle = { padding: 30, textAlign: 'center', color: '#64748b', fontSize: 12 };

function messageRowStyle(isUser) {
  return {
    display: 'flex', flexDirection: 'column',
    alignItems: isUser ? 'flex-end' : 'flex-start', gap: 6,
  };
}

function messageBubbleStyle(isUser) {
  return {
    maxWidth: '80%',
    padding: '8px 12px', borderRadius: 10,
    background: isUser ? '#1e293b' : '#f1f5f9',
    color: isUser ? '#fff' : '#0f172a',
  };
}

function messageHeaderStyle(isUser) {
  return {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
    color: isUser ? 'rgba(255,255,255,0.85)' : '#475569',
    marginBottom: 4,
  };
}

function messageBodyStyle() {
  return { fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' };
}

const proposedChangesWrapStyle = {
  width: '90%', maxWidth: '90%',
  padding: 8, background: '#fafbfc', border: '1px solid #e2e8f0', borderRadius: 8,
  marginLeft: 12,
};

function changeCardStyle(status) {
  const baseBorder = status === 'accepted' ? '#bbf7d0'
                   : status === 'rejected' ? '#fecaca'
                   : status === 'accepted_failed' ? '#fde68a'
                   : '#cbd5e1';
  return {
    padding: 8, marginTop: 6, background: '#fff',
    border: `1px solid ${baseBorder}`, borderRadius: 6,
  };
}

const changeTargetStyle = {
  fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11,
  color: '#0f172a', fontWeight: 600,
};
const changeReasonStyle = { fontSize: 11, color: '#475569', marginTop: 4, fontStyle: 'italic' };
const changeValuesStyle = {
  display: 'grid', gridTemplateColumns: '1fr 12px 1fr', gap: 6,
  marginTop: 6, alignItems: 'stretch',
};
const changeValuesLabelStyle = { fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' };
const changeArrowStyle = { fontSize: 14, color: '#94a3b8', display: 'flex', alignItems: 'center' };

function changeValuesBodyStyle(bg, color) {
  return {
    padding: '4px 6px', fontSize: 11, fontFamily: 'inherit',
    background: bg, color,
    border: '1px solid rgba(0,0,0,0.05)', borderRadius: 4,
    minHeight: 22, maxHeight: 100, overflow: 'auto',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  };
}

const changeErrorStyle = {
  marginTop: 6, padding: '4px 6px', fontSize: 11,
  background: '#fef3c7', color: '#92400e', borderRadius: 4,
};

function acceptBtnStyle(busy) {
  return {
    padding: '4px 10px', fontSize: 11, fontWeight: 600,
    background: busy ? '#94a3b8' : '#059669', color: '#fff',
    border: 'none', borderRadius: 6, cursor: busy ? 'default' : 'pointer',
  };
}
function rejectBtnStyle(busy) {
  return {
    padding: '4px 10px', fontSize: 11, fontWeight: 600,
    background: 'transparent', color: '#475569',
    border: '1px solid #cbd5e1', borderRadius: 6,
    cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
  };
}

const composerStyle = {
  padding: 12, borderTop: '1px solid #e2e8f0', background: '#fafbfc',
  borderBottomLeftRadius: 10, borderBottomRightRadius: 10,
};
function textareaStyle(disabled) {
  return {
    width: '100%', padding: 8, fontSize: 13, fontFamily: 'inherit',
    border: '1px solid #cbd5e1', borderRadius: 6,
    background: disabled ? '#f1f5f9' : '#fff',
    resize: 'vertical', boxSizing: 'border-box',
  };
}
const composerActionsStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginTop: 6,
};
const composerHintStyle = { fontSize: 10, color: '#94a3b8' };
function sendBtnStyle(disabled) {
  return {
    padding: '5px 14px', fontSize: 12, fontWeight: 600,
    background: disabled ? '#94a3b8' : '#1e293b', color: '#fff',
    border: 'none', borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
  };
}

const errorBannerStyle = {
  margin: '0 12px', padding: '6px 10px', background: '#fee2e2', color: '#991b1b',
  border: '1px solid #fecaca', borderRadius: 6, fontSize: 12,
};

const typingStyle = { padding: 8, fontSize: 11, color: '#94a3b8', fontStyle: 'italic' };

const suggestionChipStyle = {
  fontSize: 11, padding: '4px 8px', background: '#fff',
  border: '1px solid #cbd5e1', borderRadius: 9999, color: '#475569',
  cursor: 'pointer',
};

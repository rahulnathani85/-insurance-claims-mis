'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import { LOB_ICONS } from '@/lib/constants';
import { downloadAsPDF, downloadAsWord } from '@/lib/documentExport';
import { PIPELINE_STAGES, getClaimTatDeadline, getTatBadge } from '@/lib/pipelineStages';

const STATUS_STYLES = {
  'Completed': { bg: '#dcfce7', color: '#166534', icon: '✅' },
  'In Progress': { bg: '#fef3c7', color: '#92400e', icon: '🔄' },
  'Pending': { bg: '#f3f4f6', color: '#6b7280', icon: '⏳' },
  'Skipped': { bg: '#f1f5f9', color: '#94a3b8', icon: '⏭️' },
};

export default function ClaimDetail() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const [claim, setClaim] = useState(null);
  const [workflow, setWorkflow] = useState([]);
  const [history, setHistory] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [generatedDocs, setGeneratedDocs] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [pipelineStages, setPipelineStages] = useState([]);
  const [aiConversations, setAiConversations] = useState([]);
  const [aiMessage, setAiMessage] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [fsrDrafts, setFsrDrafts] = useState([]);
  const [fsrGenerating, setFsrGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  // Chat / Messages state
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageType, setMessageType] = useState('text');
  const [mentionedUsers, setMentionedUsers] = useState([]);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const [allUsers, setAllUsers] = useState([]);

  // Gmail integration state
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailAddress, setGmailAddress] = useState('');
  const [gmailEmails, setGmailEmails] = useState([]);
  const [claimEmails, setClaimEmails] = useState([]);
  const [gmailSearch, setGmailSearch] = useState('');
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [taggingEmail, setTaggingEmail] = useState(null);

  // AI chat send function
  async function sendAiMessage() {
    if (!aiMessage.trim() || aiLoading) return;
    const msg = aiMessage.trim();
    setAiMessage('');
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: parseInt(id), message: msg, user_email: user?.email }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const convRes = await fetch(`/api/ai/conversations?claim_id=${id}`);
      setAiConversations(await convRes.json());
    } catch (e) { alert('AI Error: ' + e.message); }
    finally { setAiLoading(false); }
  }

  // Document upload state
  const [uploadingDoc, setUploadingDoc] = useState(false);

  useEffect(() => {
    loadAll(); loadChatMessages(); loadUsers();
    // Load AI data
    fetch(`/api/ai/conversations?claim_id=${id}`).then(r => r.json()).then(d => setAiConversations(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`/api/ai/fsr-drafts?claim_id=${id}`).then(r => r.json()).then(d => setFsrDrafts(Array.isArray(d) ? d : [])).catch(() => {});
  }, [id]);

  async function loadAll() {
    try {
      setLoading(true);
      const [c, w, h, d, gd, a, al, r, ps] = await Promise.all([
        fetch(`/api/claims/${id}`).then(r => r.json()),
        fetch(`/api/claim-workflow?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/claim-workflow-history?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/claim-documents?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/generate-document?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/claim-assignments?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/activity-log?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/claim-reminders?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/claim-stages?claim_id=${id}`).then(r => r.json()).catch(() => []),
      ]);
      setClaim(c);
      setWorkflow(Array.isArray(w) ? w : []);
      setHistory(Array.isArray(h) ? h : []);
      setDocuments(Array.isArray(d) ? d : []);
      setGeneratedDocs(Array.isArray(gd) ? gd : []);
      setAssignments(Array.isArray(a) ? a : []);
      setActivityLogs(Array.isArray(al) ? al : []);
      setReminders(Array.isArray(r) ? r : []);
      setPipelineStages(Array.isArray(ps) ? ps : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  // Load Gmail status and tagged emails
  useEffect(() => {
    if (user?.email) {
      checkGmailStatus();
      loadClaimEmails();
    }
  }, [user, id]);

  async function checkGmailStatus() {
    try {
      const res = await fetch(`/api/gmail/status?user_email=${encodeURIComponent(user.email)}`);
      const data = await res.json();
      setGmailConnected(data.connected);
      setGmailAddress(data.gmail_address || '');
    } catch (e) { /* ignore */ }
  }

  async function connectGmail() {
    try {
      const res = await fetch(`/api/gmail/auth?user_email=${encodeURIComponent(user.email)}`);
      const data = await res.json();
      if (data.auth_url) {
        window.open(data.auth_url, '_blank');
      } else {
        alert(data.error || 'Failed to start Gmail connection');
      }
    } catch (e) { alert('Failed: ' + e.message); }
  }

  async function searchGmail() {
    setLoadingEmails(true);
    try {
      const q = gmailSearch || claim?.ref_number || claim?.insured_name || '';
      const res = await fetch(`/api/gmail/messages?user_email=${encodeURIComponent(user.email)}&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.needs_auth) { setGmailConnected(false); return; }
      setGmailEmails(data.messages || []);
    } catch (e) { console.error(e); }
    finally { setLoadingEmails(false); }
  }

  async function loadClaimEmails() {
    try {
      const res = await fetch(`/api/gmail/tag?claim_id=${id}`);
      const data = await res.json();
      setClaimEmails(Array.isArray(data) ? data : []);
    } catch (e) { /* ignore */ }
  }

  async function tagEmailToClaim(email) {
    setTaggingEmail(email.id);
    try {
      const res = await fetch('/api/gmail/tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claim_id: id,
          ref_number: claim?.ref_number,
          message_id: email.id,
          thread_id: email.threadId,
          subject: email.subject,
          sender: email.from,
          recipients: email.to,
          email_date: email.date,
          snippet: email.snippet,
          has_attachments: email.hasAttachments,
          tagged_by: user?.email,
          company: claim?.company || 'NISLA',
          user_email: user?.email,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        await loadClaimEmails();
        await loadAll(); // Refresh documents in case attachments were saved
        alert('Email tagged to this claim' + (email.hasAttachments ? ' and attachments saved!' : '!'));
      } else {
        alert(data.error || 'Failed to tag email');
      }
    } catch (e) { alert('Failed: ' + e.message); }
    finally { setTaggingEmail(null); }
  }

  async function uploadDocumentToCloud(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDoc(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('claim_id', id);
      fd.append('ref_number', claim?.ref_number || '');
      fd.append('file_type', 'other');
      fd.append('uploaded_by', user?.email || '');
      fd.append('company', claim?.company || 'NISLA');
      const res = await fetch('/api/claim-documents', { method: 'POST', body: fd });
      if (res.ok) {
        await loadAll();
        alert('Document uploaded successfully!');
      } else {
        const err = await res.json();
        alert('Upload failed: ' + (err.error || 'Unknown error'));
      }
    } catch (err) { alert('Upload failed: ' + err.message); }
    finally { setUploadingDoc(false); e.target.value = ''; }
  }

  // Load portal users for @mention
  async function loadUsers() {
    try {
      const res = await fetch('/api/auth/users');
      const data = await res.json();
      setAllUsers(Array.isArray(data) ? data.filter(u => u.is_active) : []);
    } catch (e) { console.error(e); }
  }

  // Chat / Messages functions
  async function loadChatMessages() {
    try {
      const res = await fetch(`/api/claim-messages?claim_id=${id}`);
      const data = await res.json();
      setChatMessages(Array.isArray(data) ? data : []);
      // Mark mentions as read when viewing chat
      if (user?.email) {
        fetch('/api/unread-mentions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_email: user.email, claim_id: id }),
        }).catch(() => {});
      }
    } catch (e) { console.error(e); }
  }

  // Handle @mention detection in textarea
  function handleMessageChange(e) {
    const val = e.target.value;
    setNewMessage(val);
    const cursorPos = e.target.selectionStart;
    setMentionCursorPos(cursorPos);

    // Check if user is typing @mention
    const textBeforeCursor = val.substring(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);
    if (atMatch) {
      setMentionSearch(atMatch[1].toLowerCase());
      setShowMentionDropdown(true);
    } else {
      setShowMentionDropdown(false);
      setMentionSearch('');
    }
  }

  // Insert @mention into message
  function insertMention(mentionUser) {
    const textBeforeCursor = newMessage.substring(0, mentionCursorPos);
    const textAfterCursor = newMessage.substring(mentionCursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');
    const newText = textBeforeCursor.substring(0, atIndex) + `@${mentionUser.name} ` + textAfterCursor;
    setNewMessage(newText);
    setShowMentionDropdown(false);
    setMentionSearch('');
    // Add to mentioned users list (avoid duplicates)
    if (!mentionedUsers.find(u => u.email === mentionUser.email)) {
      setMentionedUsers(prev => [...prev, { email: mentionUser.email, name: mentionUser.name }]);
    }
  }

  // Remove a tagged user
  function removeMention(email) {
    setMentionedUsers(prev => prev.filter(u => u.email !== email));
  }

  // Get filtered users for dropdown
  function getFilteredMentionUsers() {
    return allUsers.filter(u =>
      u.email !== user?.email &&
      (u.name?.toLowerCase().includes(mentionSearch) || u.email?.toLowerCase().includes(mentionSearch))
    ).slice(0, 6);
  }

  async function sendMessage() {
    if (!newMessage.trim()) return;
    setSendingMessage(true);
    try {
      const res = await fetch('/api/claim-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claim_id: id,
          ref_number: claim?.ref_number,
          sender_email: user?.email,
          sender_name: user?.name,
          message: newMessage.trim(),
          message_type: messageType,
          mentioned_users: mentionedUsers.map(u => u.email),
          mentioned_names: mentionedUsers.map(u => u.name),
          company: claim?.company || 'NISLA',
        }),
      });
      if (res.ok) {
        setNewMessage('');
        setMentionedUsers([]);
        await loadChatMessages();
      } else {
        const err = await res.json();
        alert('Failed to send: ' + (err.error || 'Unknown error'));
      }
    } catch (e) { alert('Failed: ' + e.message); }
    finally { setSendingMessage(false); }
  }

  function isOverdue(stage) {
    if (stage.status === 'Completed' || stage.status === 'Skipped') return false;
    if (!stage.due_date) return false;
    return new Date() > new Date(stage.due_date);
  }

  if (loading) return <PageLayout><div className="main-content"><div className="loading">Loading claim details...</div></div></PageLayout>;
  if (!claim || claim.error) return <PageLayout><div className="main-content"><div className="alert error">Claim not found</div></div></PageLayout>;

  const completedStages = workflow.filter(s => s.status === 'Completed').length;
  const breachedStages = workflow.filter(s => isOverdue(s)).length;
  const currentStage = workflow.find(s => s.status === 'In Progress') || workflow.find(s => s.status === 'Pending');

  const tabs = [
    { key: 'overview', label: 'Overview', icon: '📋' },
    { key: 'lifecycle', label: 'Pipeline & Lifecycle', icon: '🔄' },
    { key: 'assignments', label: 'Team', icon: '👥' },
    { key: 'documents', label: 'Documents', icon: '📄' },
    { key: 'emails', label: 'Emails', icon: '📧', badge: claimEmails.length || null },
    { key: 'ai', label: 'AI Analyst', icon: '🤖' },
    { key: 'fsr', label: 'FSR Draft', icon: '📑' },
    { key: 'chat', label: 'Chat', icon: '💬', badge: chatMessages.length || null },
    { key: 'activity', label: 'Activity', icon: '📝' },
  ];

  return (
    <PageLayout>
      <div className="main-content">
        {/* Claim Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 28 }}>{LOB_ICONS[claim.lob] || '📋'}</span>
              {claim.ref_number || `Claim #${id}`}
            </h2>
            <p style={{ color: '#6b7280', margin: '5px 0 0', fontSize: 14 }}>
              {claim.insured_name || ''} | {claim.insurer_name || ''} | {claim.lob || ''}
              {claim.broker_name ? ` | Broker: ${claim.broker_name}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              background: claim.status === 'Open' ? '#fef3c7' : claim.status === 'In Process' ? '#dbeafe' : '#dcfce7',
              color: claim.status === 'Open' ? '#92400e' : claim.status === 'In Process' ? '#1e40af' : '#166534' }}>
              {claim.status}
            </span>
            <button className="secondary" onClick={() => router.back()} style={{ fontSize: 12 }}>Back</button>
            <button className="primary" style={{ fontSize: 12 }} onClick={() => router.push(`/claim-lifecycle/${id}`)}>Open Full Lifecycle</button>
          </div>
        </div>

        {/* Quick Stats */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ padding: '10px 18px', background: '#eff6ff', borderRadius: 8, textAlign: 'center', minWidth: 100 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1e40af' }}>{completedStages}/{workflow.length || '?'}</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Stages Done</div>
          </div>
          {breachedStages > 0 && (
            <div style={{ padding: '10px 18px', background: '#fef2f2', borderRadius: 8, textAlign: 'center', minWidth: 100 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#dc2626' }}>{breachedStages}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>TAT Breached</div>
            </div>
          )}
          <div style={{ padding: '10px 18px', background: '#fefce8', borderRadius: 8, minWidth: 150 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e' }}>{currentStage?.stage_name || 'Workflow not started'}</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Current Stage</div>
          </div>
          <div style={{ padding: '10px 18px', background: '#f0fdf4', borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#166534' }}>{claim.assigned_to || 'Unassigned'}</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Assigned To</div>
          </div>
        </div>

        {/* 9-Stage Pipeline Stepper */}
        {claim.lob !== 'Extended Warranty' && (() => {
          const currentPipelineNum = claim.pipeline_stage_number || 1;
          const tatInfo = getClaimTatDeadline(claim.lob, claim.date_of_intimation || claim.date_intimation, currentPipelineNum);
          const tatBadge = tatInfo ? getTatBadge(tatInfo.deadline) : null;
          return (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>Claim Pipeline</span>
                {tatBadge && (
                  <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 10, fontWeight: 700, background: tatBadge.bg, color: tatBadge.color, border: `1px solid ${tatBadge.border}` }}>
                    {tatBadge.label}{tatInfo ? ` — ${tatInfo.milestone}` : ''}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                {PIPELINE_STAGES.map((ps, i) => {
                  const isCompleted = ps.number < currentPipelineNum;
                  const isCurrent = ps.number === currentPipelineNum;
                  const isFuture = ps.number > currentPipelineNum;
                  return (
                    <div key={ps.number} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                      {/* Connector line */}
                      {i > 0 && <div style={{ position: 'absolute', top: 14, left: 0, right: '50%', height: 3, background: isCompleted || isCurrent ? '#16a34a' : '#e2e8f0', zIndex: 0 }} />}
                      {i < PIPELINE_STAGES.length - 1 && <div style={{ position: 'absolute', top: 14, left: '50%', right: 0, height: 3, background: isCompleted ? '#16a34a' : '#e2e8f0', zIndex: 0 }} />}
                      {/* Circle */}
                      <div
                        onClick={() => {
                          if (isFuture && confirm(`Advance claim to "${ps.name}"?`)) {
                            fetch('/api/claim-stages', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ claim_id: parseInt(id), stage: ps.name, stage_number: ps.number, updated_by: user?.email, company: 'NISLA' }),
                            }).then(() => loadAll());
                          }
                        }}
                        style={{
                          width: isCurrent ? 30 : 24, height: isCurrent ? 30 : 24, borderRadius: '50%',
                          background: isCompleted ? '#16a34a' : isCurrent ? '#2563eb' : '#e2e8f0',
                          color: isCompleted || isCurrent ? '#fff' : '#94a3b8',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 700, zIndex: 1, position: 'relative',
                          cursor: isFuture ? 'pointer' : 'default',
                          border: isCurrent ? '3px solid #93c5fd' : '2px solid transparent',
                          transition: 'all 0.2s',
                        }}
                      >
                        {isCompleted ? '\u2713' : ps.number}
                      </div>
                      <div style={{ fontSize: 8, color: isCurrent ? '#2563eb' : '#64748b', fontWeight: isCurrent ? 700 : 500, marginTop: 3, textAlign: 'center', lineHeight: 1.1 }}>
                        {ps.short}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb', marginBottom: 20 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              style={{
                padding: '10px 20px', fontSize: 13, fontWeight: activeTab === t.key ? 700 : 400,
                background: 'none', border: 'none', borderBottom: activeTab === t.key ? '3px solid #1e40af' : '3px solid transparent',
                color: activeTab === t.key ? '#1e40af' : '#6b7280', cursor: 'pointer',
              }}>
              {t.icon} {t.label}
              {t.badge && <span style={{ marginLeft: 4, padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: '#1e40af', color: '#fff' }}>{t.badge}</span>}
            </button>
          ))}
        </div>

        {/* TAB: Overview */}
        {activeTab === 'overview' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* Claim Registration Details */}
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
                <h4 style={{ margin: '0 0 15px', color: '#1e40af', borderBottom: '1px solid #e5e7eb', paddingBottom: 8 }}>Claim Registration</h4>
                <table style={{ width: '100%', fontSize: 13 }}>
                  <tbody>
                    {[
                      ['Ref Number', claim.ref_number],
                      ['Claim Number', claim.claim_number],
                      ['Policy Number', claim.policy_number],
                      ['Insured Name', claim.insured_name],
                      ['Insurer', claim.insurer_name],
                      ['Broker', claim.broker_name],
                      ['LOB', claim.lob],
                      ['Policy Type', claim.policy_type],
                      ['Appointed By', claim.appointing_type],
                      ['Surveyor', claim.surveyor_name],
                      ['Assigned To', claim.assigned_to],
                      ['Status', claim.status],
                    ].map(([label, val]) => val ? (
                      <tr key={label}>
                        <td style={{ padding: '5px 0', color: '#6b7280', width: '40%' }}>{label}</td>
                        <td style={{ padding: '5px 0', fontWeight: 500 }}>{val}</td>
                      </tr>
                    ) : null)}
                  </tbody>
                </table>
              </div>

              {/* Important Dates */}
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
                <h4 style={{ margin: '0 0 15px', color: '#1e40af', borderBottom: '1px solid #e5e7eb', paddingBottom: 8 }}>Important Dates</h4>
                <table style={{ width: '100%', fontSize: 13 }}>
                  <tbody>
                    {[
                      ['Date of Intimation', claim.date_of_intimation],
                      ['Date of Loss', claim.date_loss],
                      ['Date of Survey', claim.date_survey],
                      ['Date of LOR', claim.date_lor],
                      ['Date of FSR', claim.date_fsr],
                      ['Date of Submission', claim.date_submission],
                    ].map(([label, val]) => (
                      <tr key={label}>
                        <td style={{ padding: '5px 0', color: '#6b7280', width: '50%' }}>{label}</td>
                        <td style={{ padding: '5px 0', fontWeight: 500 }}>{val || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Loss Information */}
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
                <h4 style={{ margin: '0 0 15px', color: '#1e40af', borderBottom: '1px solid #e5e7eb', paddingBottom: 8 }}>Loss Information</h4>
                <table style={{ width: '100%', fontSize: 13 }}>
                  <tbody>
                    {[
                      ['Loss Location', claim.loss_location],
                      ['Place of Survey', claim.place_survey],
                      ['Gross Loss', claim.gross_loss ? `₹ ${parseFloat(claim.gross_loss).toLocaleString('en-IN')}` : null],
                      ['Assessed Loss', claim.assessed_loss ? `₹ ${parseFloat(claim.assessed_loss).toLocaleString('en-IN')}` : null],
                    ].map(([label, val]) => (
                      <tr key={label}>
                        <td style={{ padding: '5px 0', color: '#6b7280', width: '50%' }}>{label}</td>
                        <td style={{ padding: '5px 0', fontWeight: 500 }}>{val || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {claim.remark && <div style={{ marginTop: 10, padding: 10, background: '#f8fafc', borderRadius: 6, fontSize: 12 }}><strong>Remark:</strong> {claim.remark}</div>}
              </div>

              {/* Survey Fee */}
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
                <h4 style={{ margin: '0 0 15px', color: '#1e40af', borderBottom: '1px solid #e5e7eb', paddingBottom: 8 }}>Survey Fee Details</h4>
                <table style={{ width: '100%', fontSize: 13 }}>
                  <tbody>
                    {[
                      ['Bill Number', claim.survey_fee_bill_number],
                      ['Bill Date', claim.survey_fee_bill_date],
                      ['Bill Amount', claim.survey_fee_bill_amount ? `₹ ${parseFloat(claim.survey_fee_bill_amount).toLocaleString('en-IN')}` : null],
                      ['Payment Date', claim.survey_fee_payment_date],
                    ].map(([label, val]) => (
                      <tr key={label}>
                        <td style={{ padding: '5px 0', color: '#6b7280', width: '50%' }}>{label}</td>
                        <td style={{ padding: '5px 0', fontWeight: 500 }}>{val || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB: Chat / Messages */}
        {activeTab === 'chat' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <h4 style={{ margin: 0 }}>Claim Communication Log ({chatMessages.length} messages)</h4>
              <button className="secondary" style={{ fontSize: 11 }} onClick={loadChatMessages}>Refresh</button>
            </div>

            {/* Messages List */}
            <div style={{ maxHeight: 450, overflowY: 'auto', marginBottom: 15, border: '1px solid #e5e7eb', borderRadius: 10, background: '#f8fafc', padding: 15 }}>
              {chatMessages.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, padding: 30 }}>
                  No messages yet. Start the conversation about this claim.
                </p>
              ) : (
                chatMessages.map(msg => {
                  const isMe = msg.sender_email === user?.email;
                  const isSystem = msg.message_type === 'system';
                  const isEscalation = msg.message_type === 'escalation';
                  const isNote = msg.message_type === 'note';
                  return (
                    <div key={msg.id} style={{
                      display: 'flex', flexDirection: 'column',
                      alignItems: isMe ? 'flex-end' : 'flex-start',
                      marginBottom: 10,
                    }}>
                      {isSystem ? (
                        <div style={{ textAlign: 'center', width: '100%', padding: '4px 0' }}>
                          <span style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>{msg.message}</span>
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>
                            <span style={{ fontWeight: 600 }}>{msg.sender_name}</span>
                            <span style={{ marginLeft: 8 }}>
                              {new Date(msg.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                            </span>
                            {isEscalation && <span style={{ marginLeft: 6, padding: '1px 6px', background: '#fef2f2', color: '#dc2626', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>ESCALATION</span>}
                            {isNote && <span style={{ marginLeft: 6, padding: '1px 6px', background: '#fefce8', color: '#92400e', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>NOTE</span>}
                          </div>
                          <div style={{
                            maxWidth: '75%', padding: '10px 14px', borderRadius: 12,
                            background: isEscalation ? '#fef2f2' : isNote ? '#fefce8' : isMe ? '#1e40af' : '#fff',
                            color: isMe && !isEscalation && !isNote ? '#fff' : '#1f2937',
                            border: isMe ? 'none' : '1px solid #e5e7eb',
                            borderTopRightRadius: isMe ? 4 : 12,
                            borderTopLeftRadius: isMe ? 12 : 4,
                            fontSize: 13, lineHeight: 1.5,
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                          }}>
                            {msg.message.split(/(@\w[\w\s]*?)(?=\s|$)/g).map((part, i) =>
                              part.startsWith('@') ? <span key={i} style={{ fontWeight: 700, color: isMe && !isEscalation && !isNote ? '#93c5fd' : '#1e40af' }}>{part}</span> : part
                            )}
                          </div>
                          {(() => { try { const mu = JSON.parse(msg.mentioned_users || '[]'); return mu.length > 0 ? (
                            <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                              Tagged: {mu.map((email, i) => {
                                const u = allUsers.find(u => u.email === email);
                                return <span key={i} style={{ fontWeight: 600, color: '#1e40af' }}>{i > 0 ? ', ' : ''}{u?.name || email}</span>;
                              })}
                            </div>
                          ) : null; } catch(e) { return null; } })()}
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Message Input */}
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 15 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {['text', 'note', 'escalation'].map(t => (
                  <button key={t} onClick={() => setMessageType(t)}
                    style={{
                      padding: '4px 12px', fontSize: 11, borderRadius: 8, border: '1px solid',
                      cursor: 'pointer', fontWeight: messageType === t ? 700 : 400,
                      background: messageType === t ?
                        (t === 'escalation' ? '#fef2f2' : t === 'note' ? '#fefce8' : '#eff6ff') : '#f8fafc',
                      borderColor: messageType === t ?
                        (t === 'escalation' ? '#fca5a5' : t === 'note' ? '#fde68a' : '#93c5fd') : '#e5e7eb',
                      color: messageType === t ?
                        (t === 'escalation' ? '#dc2626' : t === 'note' ? '#92400e' : '#1e40af') : '#6b7280',
                    }}>
                    {t === 'text' ? '💬 Message' : t === 'note' ? '📝 Note' : '🚨 Escalation'}
                  </button>
                ))}
              </div>

              {/* Tagged users badges */}
              {mentionedUsers.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  {mentionedUsers.map(u => (
                    <span key={u.email} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '3px 10px', background: '#eff6ff', border: '1px solid #93c5fd',
                      borderRadius: 20, fontSize: 11, color: '#1e40af', fontWeight: 600,
                    }}>
                      @{u.name}
                      <span onClick={() => removeMention(u.email)} style={{ cursor: 'pointer', color: '#6b7280', fontWeight: 400, marginLeft: 2, fontSize: 13 }}>&times;</span>
                    </span>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <textarea
                    value={newMessage}
                    onChange={handleMessageChange}
                    placeholder={messageType === 'escalation' ? 'Describe the escalation... (type @ to tag users)' : messageType === 'note' ? 'Add an internal note... (type @ to tag users)' : 'Type your message... (type @ to tag users)'}
                    style={{
                      width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8,
                      fontSize: 13, resize: 'vertical', minHeight: 50, maxHeight: 120, fontFamily: 'inherit',
                      boxSizing: 'border-box',
                    }}
                    onKeyDown={e => {
                      if (showMentionDropdown && e.key === 'Escape') { setShowMentionDropdown(false); return; }
                      if (e.key === 'Enter' && !e.shiftKey && !showMentionDropdown) { e.preventDefault(); sendMessage(); }
                    }}
                  />

                  {/* @mention dropdown */}
                  {showMentionDropdown && getFilteredMentionUsers().length > 0 && (
                    <div style={{
                      position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 4,
                      background: '#fff', border: '1px solid #d1d5db', borderRadius: 8,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)', maxHeight: 200, overflowY: 'auto', zIndex: 50,
                    }}>
                      <div style={{ padding: '6px 10px', fontSize: 10, color: '#9ca3af', fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}>
                        Tag a user
                      </div>
                      {getFilteredMentionUsers().map(u => (
                        <div key={u.email} onClick={() => insertMention(u)}
                          style={{
                            padding: '8px 12px', cursor: 'pointer', fontSize: 12,
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            borderBottom: '1px solid #f3f4f6',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = '#eff6ff'}
                          onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                        >
                          <div>
                            <span style={{ fontWeight: 600, color: '#1f2937' }}>{u.name}</span>
                            <span style={{ marginLeft: 8, color: '#9ca3af', fontSize: 11 }}>{u.email}</span>
                          </div>
                          <span style={{ padding: '1px 6px', borderRadius: 6, fontSize: 9, fontWeight: 700,
                            background: u.role === 'Admin' ? '#fef2f2' : '#f0fdf4',
                            color: u.role === 'Admin' ? '#dc2626' : '#16a34a',
                          }}>{u.role}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button className="primary" style={{ fontSize: 12, padding: '10px 20px', alignSelf: 'flex-end' }}
                  onClick={sendMessage} disabled={sendingMessage || !newMessage.trim()}>
                  {sendingMessage ? 'Sending...' : 'Send'}
                </button>
              </div>
              <p style={{ fontSize: 10, color: '#9ca3af', margin: '6px 0 0' }}>Press Enter to send, Shift+Enter for new line, type @ to tag users</p>
            </div>
          </div>
        )}

        {/* TAB: Lifecycle Timeline */}
        {activeTab === 'lifecycle' && (
          <div>
            {workflow.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <p style={{ color: '#6b7280' }}>No workflow initialized.</p>
                <button className="primary" onClick={() => router.push(`/claim-lifecycle/${id}`)}>Start Workflow</button>
              </div>
            ) : (
              <div style={{ position: 'relative', paddingLeft: 35 }}>
                <div style={{ position: 'absolute', left: 15, top: 0, bottom: 0, width: 3, background: '#e5e7eb' }} />
                {workflow.map(stage => {
                  const ss = STATUS_STYLES[stage.status] || STATUS_STYLES['Pending'];
                  const overdue = isOverdue(stage);
                  return (
                    <div key={stage.id} style={{ position: 'relative', marginBottom: 6 }}>
                      <div style={{
                        position: 'absolute', left: -27, top: 8, width: 20, height: 20, borderRadius: '50%',
                        background: overdue ? '#fef2f2' : ss.bg, border: `2px solid ${overdue ? '#dc2626' : ss.color}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, zIndex: 1
                      }}>{overdue ? '⚠️' : ss.icon}</div>
                      <div style={{
                        padding: '8px 14px', background: overdue ? '#fff5f5' : '#fff',
                        border: `1px solid ${overdue ? '#fecaca' : '#e5e7eb'}`, borderLeft: `3px solid ${overdue ? '#dc2626' : ss.color}`,
                        borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700 }}>#{stage.stage_number}</span>
                          <span style={{ fontWeight: 500, fontSize: 13 }}>{stage.stage_name}</span>
                          {overdue && <span style={{ fontSize: 9, padding: '1px 6px', background: '#dc2626', color: '#fff', borderRadius: 8, fontWeight: 700 }}>OVERDUE</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {stage.due_date && <span style={{ fontSize: 10, color: overdue ? '#dc2626' : '#9ca3af' }}>Due: {stage.due_date}</span>}
                          <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: ss.bg, color: ss.color }}>{stage.status}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div style={{ marginTop: 15 }}>
                  <button className="primary" style={{ fontSize: 12 }} onClick={() => router.push(`/claim-lifecycle/${id}`)}>
                    Open Full Lifecycle Manager
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB: Documents (LOR, ILA, etc.) */}
        {activeTab === 'documents' && (
          <div>
            {/* Generated Documents (LOR/ILA) */}
            <h4 style={{ margin: '0 0 15px' }}>Generated Documents (LOR / ILA)</h4>
            {generatedDocs.length === 0 ? (
              <p style={{ color: '#999', fontSize: 13, marginBottom: 20 }}>No LOR/ILA documents generated yet</p>
            ) : (
              <div style={{ marginBottom: 25 }}>
                {generatedDocs.map(d => (
                  <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 6 }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{d.document_type || 'Document'}</span>
                      <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 10 }}>{d.template_name || ''}</span>
                      <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 10 }}>{new Date(d.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button style={{ fontSize: 11, padding: '3px 10px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }} onClick={() => downloadAsPDF(d.content, `${d.document_type}-${claim?.ref_number || 'document'}.pdf`)}>PDF</button>
                      <button style={{ fontSize: 11, padding: '3px 10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }} onClick={() => downloadAsWord(d.content, `${d.document_type}-${claim?.ref_number || 'document'}.doc`)}>Word</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Document Checklist */}
            <h4 style={{ margin: '0 0 15px' }}>Document Checklist</h4>
            {documents.length === 0 ? (
              <p style={{ color: '#999', fontSize: 13 }}>No document tracking entries</p>
            ) : (
              <div className="mis-table-container">
                <table className="mis-table">
                  <thead>
                    <tr><th>Document</th><th>Status</th><th>Date</th><th>Notes</th></tr>
                  </thead>
                  <tbody>
                    {documents.map(d => (
                      <tr key={d.id}>
                        <td style={{ fontWeight: 500 }}>{d.document_name}</td>
                        <td>
                          <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                            background: d.status === 'Received' ? '#dcfce7' : d.status === 'Pending' ? '#fef3c7' : '#fee2e2',
                            color: d.status === 'Received' ? '#166534' : d.status === 'Pending' ? '#92400e' : '#991b1b' }}>
                            {d.status}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>{d.received_date || '-'}</td>
                        <td style={{ fontSize: 12 }}>{d.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Upload Documents to Cloud */}
            <div style={{ marginTop: 20, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: 15 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#1e40af' }}>Upload Document to Claim Folder</h4>
              <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 10px' }}>Upload PDF, images, or other files. They will be stored in the cloud under this claim's folder.</p>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xlsx,.xls,.csv,.eml"
                onChange={uploadDocumentToCloud}
                style={{ fontSize: 12 }}
                disabled={uploadingDoc}
              />
              {uploadingDoc && <p style={{ fontSize: 11, color: '#0284c7', marginTop: 6 }}>Uploading to cloud...</p>}
            </div>

            {/* Cloud-stored documents */}
            {documents.filter(d => d.storage_path).length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h4 style={{ margin: '0 0 12px' }}>Cloud Documents ({documents.filter(d => d.storage_path).length})</h4>
                {documents.filter(d => d.storage_path).map(d => (
                  <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 6 }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{d.file_name}</span>
                      <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px', borderRadius: 6, fontWeight: 600,
                        background: d.file_type === 'intimation_sheet' ? '#fef3c7' : d.source === 'gmail' ? '#dbeafe' : '#f3f4f6',
                        color: d.file_type === 'intimation_sheet' ? '#92400e' : d.source === 'gmail' ? '#1e40af' : '#6b7280',
                      }}>
                        {d.file_type === 'intimation_sheet' ? 'Intimation Sheet' : d.source === 'gmail' ? 'From Gmail' : d.file_type || 'Document'}
                      </span>
                      {d.file_size && <span style={{ marginLeft: 8, fontSize: 11, color: '#9ca3af' }}>({(d.file_size / 1024).toFixed(1)} KB)</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="secondary" style={{ fontSize: 11, padding: '3px 10px' }}
                        onClick={async () => {
                          const res = await fetch(`/api/claim-documents/${d.id}`);
                          const data = await res.json();
                          if (data.download_url) window.open(data.download_url, '_blank');
                          else alert('Download URL not available');
                        }}>Download</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 15 }}>
              <button className="primary" style={{ fontSize: 12 }} onClick={() => router.push('/lor-ila-generator')}>Go to LOR/ILA Generator</button>
            </div>
          </div>
        )}

        {/* TAB: Emails (Gmail Integration) */}
        {activeTab === 'emails' && (
          <div>
            {/* Gmail Connection Status */}
            <div style={{ background: gmailConnected ? '#f0fdf4' : '#fefce8', border: `1px solid ${gmailConnected ? '#bbf7d0' : '#fde68a'}`, borderRadius: 10, padding: 15, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>
                    {gmailConnected ? '✅ Gmail Connected' : '📧 Connect Gmail'}
                  </span>
                  {gmailConnected && gmailAddress && (
                    <span style={{ marginLeft: 8, fontSize: 12, color: '#6b7280' }}>{gmailAddress}</span>
                  )}
                </div>
                {!gmailConnected ? (
                  <button className="primary" style={{ fontSize: 12 }} onClick={connectGmail}>Connect Gmail Account</button>
                ) : (
                  <button className="secondary" style={{ fontSize: 11 }} onClick={() => { fetch(`/api/gmail/status?user_email=${encodeURIComponent(user.email)}`, { method: 'DELETE' }).then(() => { setGmailConnected(false); setGmailAddress(''); }); }}>Disconnect</button>
                )}
              </div>
              {!gmailConnected && (
                <p style={{ fontSize: 11, color: '#78716c', marginTop: 6 }}>Connect your Gmail to search and tag emails directly to this claim. Attachments will be saved automatically.</p>
              )}
            </div>

            {/* Tagged Emails */}
            <h4 style={{ margin: '0 0 12px' }}>Tagged Emails ({claimEmails.length})</h4>
            {claimEmails.length === 0 ? (
              <p style={{ color: '#999', fontSize: 13, marginBottom: 20 }}>No emails tagged to this claim yet</p>
            ) : (
              <div style={{ marginBottom: 20 }}>
                {claimEmails.map(e => (
                  <div key={e.id} style={{ padding: '10px 14px', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 6, fontSize: 13, background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, marginBottom: 2 }}>{e.subject || '(No Subject)'}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>
                          From: {e.sender} &middot; {e.email_date ? new Date(e.email_date).toLocaleDateString() : ''}
                        </div>
                        {e.snippet && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{e.snippet.substring(0, 120)}...</div>}
                      </div>
                      {e.has_attachments && <span style={{ fontSize: 10, padding: '2px 8px', background: '#dbeafe', color: '#1e40af', borderRadius: 8, fontWeight: 600 }}>📎 Attachments saved</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Search Gmail and Tag Emails */}
            {gmailConnected && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 15 }}>
                <h4 style={{ margin: '0 0 10px' }}>Search Gmail & Tag to This Claim</h4>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input
                    type="text"
                    value={gmailSearch}
                    onChange={e => setGmailSearch(e.target.value)}
                    placeholder={`Search emails (e.g. ${claim?.ref_number || claim?.insured_name || 'keyword'})`}
                    style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
                    onKeyDown={e => { if (e.key === 'Enter') searchGmail(); }}
                  />
                  <button className="primary" style={{ fontSize: 12 }} onClick={searchGmail} disabled={loadingEmails}>
                    {loadingEmails ? 'Searching...' : 'Search'}
                  </button>
                </div>

                {gmailEmails.length > 0 && (
                  <div>
                    <p style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>{gmailEmails.length} email(s) found. Click "Tag" to attach to this claim.</p>
                    {gmailEmails.map(email => {
                      const alreadyTagged = claimEmails.some(ce => ce.gmail_message_id === email.id);
                      return (
                        <div key={email.id} style={{ padding: '10px 14px', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 6, fontSize: 13, background: alreadyTagged ? '#f0fdf4' : '#fff' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, marginBottom: 2 }}>{email.subject || '(No Subject)'}</div>
                              <div style={{ fontSize: 11, color: '#6b7280' }}>
                                From: {email.from} &middot; {email.date || ''}
                                {email.hasAttachments && <span style={{ marginLeft: 6 }}>📎 Has attachments</span>}
                              </div>
                              {email.snippet && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>{email.snippet.substring(0, 150)}...</div>}
                            </div>
                            <div style={{ marginLeft: 10 }}>
                              {alreadyTagged ? (
                                <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>Tagged ✓</span>
                              ) : (
                                <button className="success" style={{ fontSize: 11, padding: '4px 12px' }}
                                  disabled={taggingEmail === email.id}
                                  onClick={() => tagEmailToClaim(email)}>
                                  {taggingEmail === email.id ? 'Tagging...' : 'Tag to Claim'}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB: Assignments */}
        {activeTab === 'assignments' && (
          <div>
            {assignments.length === 0 ? (
              <p style={{ color: '#999', fontSize: 13 }}>No assignments for this claim. Go to File Assignments to assign team members.</p>
            ) : (
              <div>
                {/* Structured Team View */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
                  {/* Lead Surveyor */}
                  {(() => { const lead = assignments.find(a => a.assignment_type === 'lead_surveyor'); return (
                    <div style={{ border: '2px solid #1e40af', borderRadius: 10, padding: 14, background: '#eff6ff' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', marginBottom: 6 }}>Lead Surveyor</div>
                      {lead ? (
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{lead.assigned_to_name || lead.assigned_to}</div>
                          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                            <span style={{ padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                              background: lead.status === 'Completed' ? '#dcfce7' : lead.status === 'In Progress' ? '#fef3c7' : '#dbeafe',
                              color: lead.status === 'Completed' ? '#166534' : lead.status === 'In Progress' ? '#92400e' : '#1e40af' }}>{lead.status}</span>
                            {lead.priority && lead.priority !== 'Normal' && <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600, background: lead.priority === 'Urgent' ? '#fef2f2' : '#fef3c7', color: lead.priority === 'Urgent' ? '#dc2626' : '#92400e' }}>{lead.priority}</span>}
                          </div>
                          {lead.target_inspection_date && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Inspection: {lead.target_inspection_date}</div>}
                          {lead.target_report_date && <div style={{ fontSize: 11, color: '#6b7280' }}>Report: {lead.target_report_date}</div>}
                        </div>
                      ) : <div style={{ fontSize: 12, color: '#94a3b8' }}>Not assigned</div>}
                    </div>
                  ); })()}

                  {/* Supporting Members */}
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', marginBottom: 6 }}>Supporting Members</div>
                    {(() => { const supports = assignments.filter(a => a.assignment_type === 'supporting'); return supports.length > 0 ? supports.map(s => (
                      <div key={s.id} style={{ padding: '4px 0', borderBottom: '1px solid #f3f4f6', fontSize: 12 }}>
                        <span style={{ fontWeight: 600 }}>{s.assigned_to_name || s.assigned_to}</span>
                        <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                          background: s.status === 'Completed' ? '#dcfce7' : '#fef3c7',
                          color: s.status === 'Completed' ? '#166534' : '#92400e' }}>{s.status}</span>
                      </div>
                    )) : <div style={{ fontSize: 12, color: '#94a3b8' }}>None assigned</div>; })()}
                  </div>

                  {/* Specialist */}
                  {(() => { const spec = assignments.find(a => a.assignment_type === 'specialist'); return (
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, background: '#faf5ff' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#86198f', textTransform: 'uppercase', marginBottom: 6 }}>Specialist</div>
                      {spec ? (
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{spec.assigned_to_name || spec.assigned_to}</div>
                          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{spec.role} | {spec.status}</div>
                        </div>
                      ) : <div style={{ fontSize: 12, color: '#94a3b8' }}>Not assigned</div>}
                    </div>
                  ); })()}
                </div>

                {/* Full Assignments Table */}
                <h4 style={{ marginBottom: 10, fontSize: 13, color: '#475569' }}>All Assignments</h4>
                <div className="mis-table-container">
                  <table className="mis-table">
                    <thead>
                      <tr><th>Assigned To</th><th>Type</th><th>Priority</th><th>Status</th><th>Inspection</th><th>Report</th><th>Notes</th></tr>
                    </thead>
                    <tbody>
                      {assignments.map(a => (
                        <tr key={a.id}>
                          <td style={{ fontWeight: 600 }}>{a.assigned_to_name || a.assigned_to}</td>
                          <td><span style={{ padding: '2px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600, background: a.assignment_type === 'lead_surveyor' ? '#dbeafe' : a.assignment_type === 'specialist' ? '#fae8ff' : '#f3f4f6', color: a.assignment_type === 'lead_surveyor' ? '#1e40af' : a.assignment_type === 'specialist' ? '#86198f' : '#374151' }}>{a.assignment_type === 'lead_surveyor' ? 'Lead' : a.assignment_type === 'supporting' ? 'Support' : a.assignment_type === 'specialist' ? 'Specialist' : 'General'}</span></td>
                          <td style={{ fontSize: 11 }}>{a.priority || 'Normal'}</td>
                          <td><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: a.status === 'Completed' ? '#dcfce7' : a.status === 'In Progress' ? '#fef3c7' : '#dbeafe', color: a.status === 'Completed' ? '#166534' : a.status === 'In Progress' ? '#92400e' : '#1e40af' }}>{a.status}</span></td>
                          <td style={{ fontSize: 11 }}>{a.target_inspection_date || '-'}</td>
                          <td style={{ fontSize: 11 }}>{a.target_report_date || '-'}</td>
                          <td style={{ fontSize: 11 }}>{a.notes || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB: AI Analyst */}
        {activeTab === 'ai' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <h4 style={{ margin: 0, color: '#1e293b' }}>AI Document Analyst</h4>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={async () => {
                    setAiLoading(true);
                    try {
                      const res = await fetch('/api/ai/analyze', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ claim_id: parseInt(id), user_email: user?.email }),
                      });
                      const data = await res.json();
                      if (data.error) throw new Error(data.error);
                      // Reload conversations
                      const convRes = await fetch(`/api/ai/conversations?claim_id=${id}`);
                      setAiConversations(await convRes.json());
                    } catch (e) { alert('AI Error: ' + e.message); }
                    finally { setAiLoading(false); }
                  }}
                  disabled={aiLoading}
                  style={{ padding: '8px 16px', background: aiLoading ? '#94a3b8' : '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: aiLoading ? 'default' : 'pointer' }}
                >
                  {aiLoading ? 'Analysing...' : '🔍 Analyse Documents'}
                </button>
                <button
                  onClick={async () => {
                    const convRes = await fetch(`/api/ai/conversations?claim_id=${id}`);
                    setAiConversations(await convRes.json());
                  }}
                  style={{ padding: '8px 12px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
                >
                  Refresh
                </button>
              </div>
            </div>

            {/* Conversation History */}
            <div style={{ background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', padding: 16, minHeight: 200, maxHeight: 500, overflowY: 'auto', marginBottom: 15 }}>
              {aiConversations.length === 0 ? (
                <p style={{ color: '#94a3b8', textAlign: 'center', padding: 40 }}>No AI analysis yet. Click "Analyse Documents" to start.</p>
              ) : (
                aiConversations.filter(c => c.role !== 'system').map(c => (
                  <div key={c.id} style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', alignItems: c.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>
                      {c.role === 'assistant' ? '🤖 AI Analyst' : `👤 ${c.created_by || 'You'}`} · {c.created_at ? new Date(c.created_at).toLocaleString('en-IN') : ''}
                    </div>
                    <div style={{
                      maxWidth: '85%', padding: '10px 14px', borderRadius: 10,
                      background: c.role === 'user' ? '#1e40af' : '#fff',
                      color: c.role === 'user' ? '#fff' : '#1e293b',
                      border: c.role === 'assistant' ? '1px solid #e2e8f0' : 'none',
                      fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                    }}>
                      {c.message}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Chat Input */}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={aiMessage}
                onChange={e => setAiMessage(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && aiMessage.trim()) { e.preventDefault(); sendAiMessage(); } }}
                placeholder="Ask the AI analyst about this claim..."
                style={{ flex: 1, padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
              />
              <button
                onClick={sendAiMessage}
                disabled={aiLoading || !aiMessage.trim()}
                style={{ padding: '10px 20px', background: aiLoading ? '#94a3b8' : '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: aiLoading ? 'default' : 'pointer' }}
              >
                {aiLoading ? '...' : 'Send'}
              </button>
            </div>
          </div>
        )}

        {/* TAB: FSR Draft */}
        {activeTab === 'fsr' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <h4 style={{ margin: 0, color: '#1e293b' }}>AI-Generated FSR Draft</h4>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={async () => {
                    setFsrGenerating(true);
                    try {
                      const res = await fetch('/api/ai/generate-fsr', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ claim_id: parseInt(id), user_email: user?.email }),
                      });
                      const data = await res.json();
                      if (data.error) throw new Error(data.error);
                      // Reload drafts
                      const draftRes = await fetch(`/api/ai/fsr-drafts?claim_id=${id}`);
                      setFsrDrafts(await draftRes.json());
                    } catch (e) { alert('FSR Error: ' + e.message); }
                    finally { setFsrGenerating(false); }
                  }}
                  disabled={fsrGenerating}
                  style={{ padding: '8px 16px', background: fsrGenerating ? '#94a3b8' : '#059669', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: fsrGenerating ? 'default' : 'pointer' }}
                >
                  {fsrGenerating ? 'Generating...' : '📝 Generate FSR Draft'}
                </button>
                <button
                  onClick={async () => {
                    const draftRes = await fetch(`/api/ai/fsr-drafts?claim_id=${id}`);
                    setFsrDrafts(await draftRes.json());
                  }}
                  style={{ padding: '8px 12px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
                >
                  Refresh
                </button>
              </div>
            </div>

            {fsrDrafts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 50, color: '#94a3b8' }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>📑</div>
                <p>No FSR drafts yet. Click "Generate FSR Draft" to create one using AI.</p>
                <p style={{ fontSize: 12 }}>Tip: Run "Analyse Documents" first in the AI Analyst tab for better results.</p>
              </div>
            ) : (
              fsrDrafts.map(draft => (
                <div key={draft.id} style={{ marginBottom: 20, border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>Version {draft.version_number}</span>
                      <span style={{ marginLeft: 10, padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                        background: draft.status === 'approved' ? '#dcfce7' : draft.status === 'final' ? '#dbeafe' : '#fef3c7',
                        color: draft.status === 'approved' ? '#166534' : draft.status === 'final' ? '#1e40af' : '#92400e'
                      }}>{draft.status.toUpperCase()}</span>
                      <span style={{ marginLeft: 10, fontSize: 11, color: '#94a3b8' }}>{draft.generated_at ? new Date(draft.generated_at).toLocaleString('en-IN') : ''}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {draft.status === 'draft' && (
                        <button onClick={async () => {
                          await fetch('/api/ai/fsr-drafts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: draft.id, status: 'approved', approved_by: user?.email }) });
                          const draftRes = await fetch(`/api/ai/fsr-drafts?claim_id=${id}`);
                          setFsrDrafts(await draftRes.json());
                        }} style={{ padding: '4px 12px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                          ✓ Approve
                        </button>
                      )}
                      <button onClick={() => {
                        const win = window.open('', '_blank');
                        win.document.write(`<html><head><title>FSR - ${claim.ref_number}</title><style>body{font-family:Arial,sans-serif;padding:40px;max-width:800px;margin:0 auto;line-height:1.6} table{border-collapse:collapse;width:100%} th,td{border:1px solid #ddd;padding:8px;text-align:left} .ai-field{background:#fef3c7;padding:2px 4px;border-radius:3px;font-size:11px;color:#92400e} @media print{body{padding:20px}}</style></head><body>${draft.draft_content}</body></html>`);
                        win.document.close();
                        win.print();
                      }} style={{ padding: '4px 12px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>
                        🖨️ Print
                      </button>
                    </div>
                  </div>
                  <div style={{ padding: 20, fontSize: 13, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: draft.draft_content }} />
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB: Activity Log */}
        {activeTab === 'activity' && (
          <div>
            {/* Combine workflow history + activity logs */}
            {(() => {
              const allActivity = [
                ...history.map(h => ({ ...h, source: 'workflow', time: h.created_at })),
                ...activityLogs.map(a => ({ ...a, source: 'activity', time: a.created_at, details: a.details || `${a.action} - ${a.entity_type}` })),
              ].sort((a, b) => new Date(b.time) - new Date(a.time));

              return allActivity.length === 0 ? (
                <p style={{ color: '#999', fontSize: 13 }}>No activity recorded for this claim</p>
              ) : (
                <div>
                  {allActivity.map((item, idx) => (
                    <div key={`${item.source}-${item.id}-${idx}`} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
                      <div style={{ minWidth: 130, fontSize: 11, color: '#9ca3af' }}>
                        {new Date(item.time).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </div>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{item.user_name || item.user_email || '-'}</span>
                        <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                          background: item.action === 'comment' ? '#dbeafe' : item.action === 'assign' ? '#fae8ff' : '#fef3c7',
                          color: item.action === 'comment' ? '#1e40af' : item.action === 'assign' ? '#86198f' : '#92400e' }}>
                          {item.action}
                        </span>
                        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4b5563' }}>{item.details || '-'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </PageLayout>
  );
}

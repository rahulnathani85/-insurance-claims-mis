'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import { LOB_ICONS } from '@/lib/constants';

const STATUS_STYLES = {
  'Completed': { bg: '#dcfce7', color: '#166534', icon: 'â' },
  'In Progress': { bg: '#fef3c7', color: '#92400e', icon: 'ð' },
  'Pending': { bg: '#f3f4f6', color: '#6b7280', icon: 'â³' },
  'Skipped': { bg: '#f1f5f9', color: '#94a3b8', icon: 'â­ï¸' },
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

  // Document upload state
  const [uploadingDoc, setUploadingDoc] = useState(false);

  useEffect(() => { loadAll(); loadChatMessages(); loadUsers(); }, [id]);

  async function loadAll() {
    try {
      setLoading(true);
      const [c, w, h, d, gd, a, al, r] = await Promise.all([
        fetch(`/api/claims/${id}`).then(r => r.json()),
        fetch(`/api/claim-workflow?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/claim-workflow-history?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/claim-documents?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/generate-document?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/claim-assignments?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/activity-log?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/claim-reminders?claim_id=${id}`).then(r => r.json()).catch(() => []),
      ]);
      setClaim(c);
      setWorkflow(Array.isArray(w) ? w : []);
      setHistory(Array.isArray(h) ? h : []);
      setDocuments(Array.isArray(d) ? d : []);
      setGeneratedDocs(Array.isArray(gd) ? gd : []);
      setAssignments(Array.isArray(a) ? a : []);
      setActivityLogs(Array.isArray(al) ? al : []);
      setReminders(Array.isArray(r) ? r : []);
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
    { key: 'overview', label: 'Overview', icon: 'ð' },
    { key: 'chat', label: 'Chat', icon: 'ð¬', badge: chatMessages.length || null },
    { key: 'lifecycle', label: 'Lifecycle', icon: 'ð' },
    { key: 'documents', label: 'Documents', icon: 'ð' },
    { key: 'emails', label: 'Emails', icon: 'ð§', badge: claimEmails.length || null },
    { key: 'assignments', label: 'Assignments', icon: 'ð¥' },
    { key: 'activity', label: 'Activity Log', icon: 'ð' },
  ];

  return (
    <PageLayout>
      <div className="main-content">
        {/* Claim Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 28 }}>{LOB_ICONS[claim.lob] || 'ð'}</span>
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
          <div style={{ padding: '10px 18px', background: '#f0fdf4', borderRadius_O]Ý[O^ÞÈÛÚ^NLÛÙZYÚ
ÛÛÜ	ÈÌMLÍ	È_OØÛZ[K\ÜÚYÛYÝÈ	Õ[\ÜÚYÛY	ßOÙ]]Ý[O^ÞÈÛÚ^NLKÛÛÜ	ÈÍÌ	È_O\ÜÚYÛYÏÙ]Ù]Ù]ËÊXÈ
ßB]Ý[O^ÞÈ\Ü^N	Ù^	ËØ\Ü\ÝÛN	ÌÛÛYÙMYMÙXËX\Ú[ÝÛN_OÝXËX\
O
]ÛÙ^O^ÝÙ^_HÛÛXÚÏ^Ê
HOÙ]XÝ]UXÙ^J_BÝ[O^ÞÂY[Î	ÌL	ËÛÚ^NLËÛÙZYÚXÝ]UXOOHÙ^HÈ
Ì
XÚÙÜÝ[	ÛÛIËÜ\	ÛÛIËÜ\ÝÛNXÝ]UXOOHÙ^HÈ	ÌÜÛÛYÌYMYÈ	ÌÜÛÛY[Ü\[	ËÛÛÜXÝ]UXOOHÙ^HÈ	ÈÌYMYÈ	ÈÍÌ	ËÝ\ÛÜ	ÜÚ[\Ë_OÝXÛÛHÝX[BÝYÙH	Ü[Ý[O^ÞÈX\Ú[Y
Y[Î	Ì\
	ËÜ\Y]\ÎLÛÚ^NLÛÙZYÚ
ÌXÚÙÜÝ[	ÈÌYMYËÛÛÜ	ÈÙÈ_OÝYÙ_OÜÜ[BØ]Û
J_BÙ]ËÊPÝ\Y]È
ßBØXÝ]UXOOH	ÛÝ\Y]ÉÈ	
]]Ý[O^ÞÈ\Ü^N	ÙÜY	ËÜY[\]PÛÛ[[Î	ÌYYËØ\_OËÊÛZ[HYÚ\Ý][Û]Z[È
ßB]Ý[O^ÞÈXÚÙÜÝ[	ÈÙËÜ\	Ì\ÛÛYÙMYMÙXËÜ\Y]\ÎLY[Î_O
Ý[O^ÞÈX\Ú[	ÌM\	ËÛÛÜ	ÈÌYMYËÜ\ÝÛN	Ì\ÛÛYÙMYMÙXËY[ÐÝÛN_OÛZ[HYÚ\Ý][ÛÚ
XHÝ[O^ÞÈÚY	ÌL	IËÛÚ^NLÈ_OÙOÖÂÉÔY[X\ËÛZ[KYÛ[X\KÉÐÛZ[H[X\ËÛZ[KÛZ[WÛ[X\KÉÔÛXÞH[X\ËÛZ[KÛXÞWÛ[X\KÉÒ[Ý\Y[YIËÛZ[K[Ý\YÛ[YWKÉÒ[Ý\\ËÛZ[K[Ý\\Û[YWKÉÐÚÙ\ËÛZ[KÚÙ\Û[YWKÉÓÐËÛZ[KØKÉÔÛXÞH\IËÛZ[KÛXÞWÝ\WKÉÐ\Ú[YIËÛZ[K\Ú[[×Ý\WKÉÔÝ\^[ÜËÛZ[KÝ\^[ÜÛ[YWKÉÐ\ÜÚYÛYÉËÛZ[K\ÜÚYÛYÝ×KÉÔÝ]\ÉËÛZ[KÝ]\×KKX\

ÛX[[JHO[È
Ù^O^ÛX[OÝ[O^ÞÈY[Î	Í\	ËÛÛÜ	ÈÍÌ	ËÚY	Í	IÈ_OÛX[OÝÝ[O^ÞÈY[Î	Í\	ËÛÙZYÚ
L_OÝ[OÝÝ
H[
_BÝÙOÝXOÙ]ËÊ[\Ü[]\È
ßB]Ý[O^ÞÈXÚÙÜÝ[	ÈÙËÜ\	Ì\ÛÛYÙMYMÙXËÜ\Y]\ÎLY[Î_O
Ý[O^ÞÈX\Ú[	ÌM\	ËÛÛÜ	ÈÌYMYËÜ\ÝÛN	Ì\ÛÛYÙMYMÙXËY[ÐÝÛN_O[\Ü[]\ÏÚ
XHÝ[O^ÞÈÚY	ÌL	IËÛÚ^NLÈ_OÙOÖÂÉÑ]HÙ[[X][ÛËÛZ[K]WÚ[[X][ÛKÉÑ]HÙÜÜÉËÛZ[K]WÛÜÜ×KÉÑ]HÙÝ\^IËÛZ[K]WÜÝ\^WKÉÑ]HÙÔËÛZ[K]WÛÜKÉÑ]HÙÔËÛZ[K]WÙÜKÉÑ]HÙÝXZ\ÜÚ[ÛËÛZ[K]WÜÝXZ\ÜÚ[ÛKKX\

ÛX[[JHO
Ù^O^ÛX[OÝ[O^ÞÈY[Î	Í\	ËÛÛÜ	ÈÍÌ	ËÚY	ÍL	IÈ_OÛX[OÝÝ[O^ÞÈY[Î	Í\	ËÛÙZYÚ
L_OÝ[	ËIßOÝÝ
J_BÝÙOÝXOÙ]ËÊÜÜÈ[ÜX][Û
ßB]Ý[O^ÞÈXÚÙÜÝ[	ÈÙËÜ\	Ì\ÛÛYÙMYMÙXËÜ\Y]\ÎLY[Î_O
Ý[O^ÞÈX\Ú[	ÌM\	ËÛÛÜ	ÈÌYMYËÜ\ÝÛN	Ì\ÛÛYÙMYMÙXËY[ÐÝÛN_OÜÜÈ[ÜX][ÛÚ
XHÝ[O^ÞÈÚY	ÌL	IËÛÚ^NLÈ_OÙOÖÂÉÓÜÜÈØØ][ÛËÛZ[KÜÜ×ÛØØ][ÛKÉÔXÙHÙÝ\^IËÛZ[KXÙWÜÝ\^WKÉÑÜÜÜÈÜÜÉËÛZ[KÜÜÜ×ÛÜÜÈÈ8 ®H	Ü\ÙQØ]
ÛZ[KÜÜÜ×ÛÜÜÊKÓØØ[TÝ[Ê	Ù[RSÊ_X[KÉÐ\ÜÙ\ÜÙYÜÜÉËÛZ[K\ÜÙ\ÜÙYÛÜÜÈÈ8 ®H	Ü\ÙQØ]
ÛZ[K\ÜÙ\ÜÙYÛÜÜÊKÓØØ[TÝ[Ê	Ù[RSÊ_X[KKX\

ÛX[[JHO
Ù^O^ÛX[OÝ[O^ÞÈY[Î	Í\	ËÛÛÜ	ÈÍÌ	ËÚY	ÍL	IÈ_OÛX[OÝÝ[O^ÞÈY[Î	Í\	ËÛÙZYÚ
L_OÝ[	ËIßOÝÝ
J_BÝÙOÝXOØÛZ[K[X\È	]Ý[O^ÞÈX\Ú[ÜLY[ÎLXÚÙÜÝ[	ÈÙYÉËÜ\Y]\Î
ÛÚ^NL_OÝÛÏ[X\ÎÜÝÛÏØÛZ[K[X\ßOÙ]BÙ]ËÊÝ\^HYH
ßB]Ý[O^ÞÈXÚÙÜÝ[	ÈÙËÜ\	Ì\ÛÛYÙMYMÙXËÜ\Y]\ÎLY[Î_O
Ý[O^ÞÈX\Ú[	ÌM\	ËÛÛÜ	ÈÌYMYËÜ\ÝÛN	Ì\ÛÛYÙMYMÙXËY[ÐÝÛN_OÝ\^HYH]Z[ÏÚ
XHÝ[O^ÞÈÚY	ÌL	IËÛÚ^NLÈ_OÙOÖÂÉÐ[[X\ËÛZ[KÝ\^WÙYWØ[Û[X\KÉÐ[]IËÛZ[KÝ\^WÙYWØ[Ù]WKÉÐ[[[Ý[	ËÛZ[KÝ\^WÙYWØ[Ø[[Ý[È8 ®H	Ü\ÙQØ]
ÛZ[KÝ\^WÙYWØ[Ø[[Ý[
KÓØØ[TÝ[Ê	Ù[RSÊ_X[KÉÔ^[Y[]IËÛZ[KÝ\^WÙYWÜ^[Y[Ù]WKKX\

ÛX[[JHO
Ù^O^ÛX[OÝ[O^ÞÈY[Î	Í\	ËÛÛÜ	ÈÍÌ	ËÚY	ÍL	IÈ_OÛX[OÝÝ[O^ÞÈY[Î	Í\	ËÛÙZYÚ
L_OÝ[	ËIßOÝÝ
J_BÝÙOÝXOÙ]Ù]Ù]
_BËÊPÚ]ÈY\ÜØYÙ\È
ßBØXÝ]UXOOH	ØÚ]	È	
]]Ý[O^ÞÈ\Ü^N	Ù^	Ë\ÝYPÛÛ[	ÜÜXÙKX]ÙY[Ë[YÛ][\Î	ØÙ[\ËX\Ú[ÝÛNMH_O
Ý[O^ÞÈX\Ú[_OÛZ[HÛÛ[][XØ][ÛÙÈ
ØÚ]Y\ÜØYÙ\Ë[ÝHY\ÜØYÙ\ÊOÚ
]ÛÛ\ÜÓ[YOHÙXÛÛ\HÝ[O^ÞÈÛÚ^NLH_HÛÛXÚÏ^ÛØYÚ]Y\ÜØYÙ\ßOY\ÚØ]ÛÙ]ËÊY\ÜØYÙ\È\Ý
ßB]Ý[O^ÞÈX^ZYÚ

LÝ\ÝÖN	Ø]]ÉËX\Ú[ÝÛNMKÜ\	Ì\ÛÛYÙMYMÙXËÜ\Y]\ÎLXÚÙÜÝ[	ÈÙYÉËY[ÎMH_OØÚ]Y\ÜØYÙ\Ë[ÝOOHÈ
Ý[O^ÞÈ^[YÛ	ØÙ[\ËÛÛÜ	ÈÎXØLØYËÛÚ^NLËY[ÎÌ_OÈY\ÜØYÙ\ÈY]Ý\HÛÛ\Ø][ÛXÝ]\ÈÛZ[KÜ
H
Ú]Y\ÜØYÙ\ËX\
\ÙÈOÂÛÛÝ\ÓYHH\ÙËÙ[\Ù[XZ[OOH\Ù\Ë[XZ[ÂÛÛÝ\ÔÞ\Ý[HH\ÙËY\ÜØYÙWÝ\HOOH	ÜÞ\Ý[IÎÂÛÛÝ\Ñ\ØØ[][ÛH\ÙËY\ÜØYÙWÝ\HOOH	Ù\ØØ[][ÛÎÂÛÛÝ\ÓÝHH\ÙËY\ÜØYÙWÝ\HOOH	ÛÝIÎÂ]\
]Ù^O^Û\ÙËYHÝ[O^ÞÂ\Ü^N	Ù^	Ë^\XÝ[Û	ØÛÛ[[Ë[YÛ][\Î\ÓYHÈ	Ù^Y[	È	Ù^\Ý\	ËX\Ú[ÝÛNL_OÚ\ÔÞ\Ý[HÈ
]Ý[O^ÞÈ^[YÛ	ØÙ[\ËÚY	ÌL	IËY[Î	Í	È_OÜ[Ý[O^ÞÈÛÚ^NLKÛÛÜ	ÈÎXØLØYËÛÝ[N	Ú][XÉÈ_OÛ\ÙËY\ÜØYÙ_OÜÜ[Ù]
H
]Ý[O^ÞÈÛÚ^NLKÛÛÜ	ÈÎXØLØYËX\Ú[ÝÛNÈ_OÜ[Ý[O^ÞÈÛÙZYÚ
_OÛ\ÙËÙ[\Û[Y_OÜÜ[Ü[Ý[O^ÞÈX\Ú[Y_OÛ]È]J\ÙËÜX]YØ]
KÓØØ[TÝ[Ê	Ù[RSËÈ]TÝ[N	ÛYY][IË[YTÝ[N	ÜÚÜ	ÈJ_BÜÜ[Ú\Ñ\ØØ[][Û	Ü[Ý[O^ÞÈX\Ú[Y
Y[Î	Ì\
	ËXÚÙÜÝ[	ÈÙYËÛÛÜ	ÈÙÌËÜ\Y]\Î
ÛÚ^NLÛÙZYÚ
Ì_OTÐÐTÐUÓÜÜ[BÚ\ÓÝH	Ü[Ý[O^ÞÈX\Ú[Y
Y[Î	Ì\
	ËXÚÙÜÝ[	ÈÙYÙN	ËÛÛÜ	ÈÎLIËÜ\Y]\Î
ÛÚ^NLÛÙZYÚ
Ì_OÕOÜÜ[BÙ]]Ý[O^ÞÂX^ÚY	ÍÍIIËY[Î	ÌLM	ËÜ\Y]\ÎLXÚÙÜÝ[\Ñ\ØØ[][ÛÈ	ÈÙYÈ\ÓÝHÈ	ÈÙYÙN	È\ÓYHÈ	ÈÌYMYÈ	ÈÙËÛÛÜ\ÓYH	Z\Ñ\ØØ[][Û	Z\ÓÝHÈ	ÈÙÈ	ÈÌYLÍÉËÜ\\ÓYHÈ	ÛÛIÈ	Ì\ÛÛYÙMYMÙXËÜ\ÜYÚY]\Î\ÓYHÈ
LÜ\ÜYY]\Î\ÓYHÈL
ÛÚ^NLË[RZYÚKKÞÚYÝÎ	Ì\ØJ
JIË_OÛ\ÙËY\ÜØYÙKÜ]
ÊÖ×××JÊJÏWß	
KÙÊKX\

\JHO\Ý\ÕÚ]
	Ð	ÊHÈÜ[Ù^O^Ú_HÝ[O^ÞÈÛÙZYÚ
ÌÛÛÜ\ÓYH	Z\Ñ\ØØ[][Û	Z\ÓÝHÈ	ÈÎLØÍY	È	ÈÌYMYÈ_OÜ\OÜÜ[\
_BÙ]Ê

HOÈHÈÛÛÝ]HHÓÓ\ÙJ\ÙËY[[ÛYÝ\Ù\È	Ö×IÊNÈ]\]K[ÝÈ
]Ý[O^ÞÈÛÚ^NLÛÛÜ	ÈÍÌ	ËX\Ú[Ü_OYÙÙYÛ]KX\

[XZ[JHOÂÛÛÝHH[\Ù\Ë[
HOK[XZ[OOH[XZ[
NÂ]\Ü[Ù^O^Ú_HÝ[O^ÞÈÛÙZYÚ
ÛÛÜ	ÈÌYMYÈ_OÚHÈ	Ë	È	Éß^ÝOË[YH[XZ[OÜÜ[ÂJ_BÙ]
H[ÈHØ]Ú
JHÈ]\[ÈHJJ
_BÏ
_BÙ]
NÂJB
_BÙ]ËÊY\ÜØYÙH[]
ßB]Ý[O^ÞÈXÚÙÜÝ[	ÈÙËÜ\	Ì\ÛÛYÙMYMÙXËÜ\Y]\ÎLY[ÎMH_O]Ý[O^ÞÈ\Ü^N	Ù^	ËØ\X\Ú[ÝÛN^Ü\	ÝÜ\	Ë[YÛ][\Î	ØÙ[\È_OÖÉÝ^	Ë	ÛÝIË	Ù\ØØ[][Û×KX\
O
]ÛÙ^O^ÝHÛÛXÚÏ^Ê
HOÙ]Y\ÜØYÙU\J
_BÝ[O^ÞÂY[Î	ÍL	ËÛÚ^NLKÜ\Y]\ÎÜ\	Ì\ÛÛY	ËÝ\ÛÜ	ÜÚ[\ËÛÙZYÚY\ÜØYÙU\HOOHÈ
Ì
XÚÙÜÝ[Y\ÜØYÙU\HOOHÂ
OOH	Ù\ØØ[][ÛÈÈ	ÈÙYÈOOH	ÛÝIÈÈ	ÈÙYÙN	È	ÈÙYÊH	ÈÙYÉËÜ\ÛÛÜY\ÜØYÙU\HOOHÂ
OOH	Ù\ØØ[][ÛÈÈ	ÈÙØMXMIÈOOH	ÛÝIÈÈ	ÈÙMIÈ	ÈÎLØÍY	ÊH	ÈÙMYMÙXËÛÛÜY\ÜØYÙU\HOOHÂ
OOH	Ù\ØØ[][ÛÈÈ	ÈÙÌÈOOH	ÛÝIÈÈ	ÈÎLIÈ	ÈÌYMYÊH	ÈÍÌ	Ë_OÝOOH	Ý^	ÈÈ	ü'ä«Y\ÜØYÙIÈOOH	ÛÝIÈÈ	ü'äçHÝIÈ	ü'æª\ØØ[][ÛßBØ]Û
J_BÙ]ËÊYÙÙY\Ù\ÈYÙ\È
ßBÛY[[ÛY\Ù\Ë[Ý	
]Ý[O^ÞÈ\Ü^N	Ù^	ËØ\
^Ü\	ÝÜ\	ËX\Ú[ÝÛN_OÛY[[ÛY\Ù\ËX\
HO
Ü[Ù^O^ÝK[XZ[HÝ[O^ÞÂ\Ü^N	Ú[[KY^	Ë[YÛ][\Î	ØÙ[\ËØ\
Y[Î	ÌÜL	ËXÚÙÜÝ[	ÈÙYËÜ\	Ì\ÛÛYÎLØÍY	ËÜ\Y]\ÎÛÚ^NLKÛÛÜ	ÈÌYMYËÛÙZYÚ
_OÝK[Y_BÜ[ÛÛXÚÏ^Ê
HO[[ÝSY[[ÛK[XZ[
_HÝ[O^ÞÈÝ\ÛÜ	ÜÚ[\ËÛÛÜ	ÈÍÌ	ËÛÙZYÚ
X\Ú[YÛÚ^NLÈ_O[Y\ÎÏÜÜ[ÜÜ[
J_BÙ]
_B]Ý[O^ÞÈ\Ü^N	Ù^	ËØ\ÜÚ][Û	Ü[]]IÈ_O]Ý[O^ÞÈ^KÜÚ][Û	Ü[]]IÈ_O^\XB[YO^Û]ÓY\ÜØYÙ_BÛÚ[ÙO^Ú[SY\ÜØYÙPÚ[Ù_BXÙZÛ\^ÛY\ÜØYÙU\HOOH	Ù\ØØ[][ÛÈÈ	Ñ\ØÜXHH\ØØ[][Û
\HÈYÈ\Ù\ÊIÈY\ÜØYÙU\HOOH	ÛÝIÈÈ	ÐY[[\[ÝK
\HÈYÈ\Ù\ÊIÈ	Õ\H[Ý\Y\ÜØYÙK
\HÈYÈ\Ù\ÊIßBÝ[O^ÞÂÚY	ÌL	IËY[Î	ÌLL	ËÜ\	Ì\ÛÛYÙY
YËÜ\Y]\ÎÛÚ^NLË\Ú^N	Ý\XØ[	ËZ[ZYÚ
LX^ZYÚLÛ[Z[N	Ú[\]	ËÞÚ^[Î	ØÜ\XÞ	Ë_BÛÙ^QÝÛ^ÙHOÂY
ÚÝÓY[[ÛÜÝÛ	KÙ^HOOH	Ñ\ØØ\IÊHÈÙ]ÚÝÓY[[ÛÜÝÛ[ÙJNÈ]\ÈBY
KÙ^HOOH	Ñ[\È	YKÚYÙ^H	\ÚÝÓY[[ÛÜÝÛHÈK][Y][

NÈÙ[Y\ÜØYÙJ
NÈB_BÏËÊY[[ÛÜÝÛ
ßBÜÚÝÓY[[ÛÜÝÛ	Ù][\YY[[Û\Ù\Ê
K[Ý	
]Ý[O^ÞÂÜÚ][Û	ØXÛÛ]IËÝÛN	ÌL	IËYYÚX\Ú[ÝÛN
XÚÙÜÝ[	ÈÙËÜ\	Ì\ÛÛYÙY
YËÜ\Y]\ÎÞÚYÝÎ	Ì
LØJMJIËX^ZYÚÝ\ÝÖN	Ø]]ÉË[^
L_O]Ý[O^ÞÈY[Î	ÍL	ËÛÚ^NLÛÛÞ: '#9ca3af', fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}>
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
                      }}>{overdue ? 'â ï¸' : ss.icon}</div>
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
                    </div>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>{new Date(d.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
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
                    {gmailConnected ? 'â Gmail Connected' : 'ð§ Connect Gmail'}
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
                      {e.has_attachments && <span style={{ fontSize: 10, padding: '2px 8px', background: '#dbeafe', color: '#1e40af', borderRadius: 8, fontWeight: 600 }}>ð Attachments saved</span>}
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
                                {email.hasAttachments && <span style={{ marginLeft: 6 }}>ð Has attachments</span>}
                              </div>
                              {email.snippet && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>{email.snippet.substring(0, 150)}...</div>}
                            </div>
                            <div style={{ marginLeft: 10 }}>
                              {alreadyTagged ? (
                                <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>Tagged â</span>
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
              <p style={{ color: '#999', fontSize: 13 }}>No assignments for this claim</p>
            ) : (
              <div className="mis-table-container">
                <table className="mis-table">
                  <thead>
                    <tr><th>Assigned To</th><th>Role</th><th>Status</th><th>Date</th><th>Due</th><th>Notes</th></tr>
                  </thead>
                  <tbody>
                    {assignments.map(a => (
                      <tr key={a.id}>
                        <td style={{ fontWeight: 600 }}>{a.assigned_to}</td>
                        <td>{a.role}</td>
                        <td>
                          <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                            background: a.status === 'Completed' ? '#dcfce7' : a.status === 'In Progress' ? '#fef3c7' : '#dbeafe',
                            color: a.status === 'Completed' ? '#166534' : a.status === 'In Progress' ? '#92400e' : '#1e40af' }}>
                            {a.status}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>{a.assigned_date || '-'}</td>
                        <td style={{ fontSize: 12 }}>{a.due_date || '-'}</td>
                        <td style={{ fontSize: 12 }}>{a.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

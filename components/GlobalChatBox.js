'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { useRouter } from 'next/navigation';

export default function GlobalChatBox({ onUnreadChange }) {
  const { user } = useAuth();
  const { company } = useCompany();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionStartPos, setMentionStartPos] = useState(-1);
  const [allUsers, setAllUsers] = useState([]);
  const [mentionedUsers, setMentionedUsers] = useState([]);
  const [mentionedNames, setMentionedNames] = useState([]);

  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const [fileSearch, setFileSearch] = useState('');
  const [fileStartPos, setFileStartPos] = useState(-1);
  const [fileResults, setFileResults] = useState([]);
  const [taggedFiles, setTaggedFiles] = useState([]);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const chatBodyRef = useRef(null);
  const fileSearchTimeout = useRef(null);

  useEffect(() => { if (user) loadUsers(); }, [user, company]);

  useEffect(() => {
    if (user?.email) {
      fetchUnreadCount();
      const interval = setInterval(fetchUnreadCount, 15000);
      return () => clearInterval(interval);
    }
  }, [user, company]);

  useEffect(() => { if (isOpen && user) { loadMessages(); markAllAsRead(); } }, [isOpen]);

  useEffect(() => {
    if (isOpen && messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  useEffect(() => {
    if (isOpen && user) {
      const interval = setInterval(() => { loadMessages(); markAllAsRead(); }, 10000);
      return () => clearInterval(interval);
    }
  }, [isOpen, user, company]);

  async function loadUsers() {
    try {
      const res = await fetch('/api/auth?company=' + encodeURIComponent(company));
      const data = await res.json();
      if (Array.isArray(data)) setAllUsers(data.filter(u => u.email !== user?.email));
    } catch (e) {}
  }

  async function loadMessages() {
    try {
      const res = await fetch('/api/global-chat?company=' + encodeURIComponent(company) + '&limit=100');
      const data = await res.json();
      if (Array.isArray(data)) setMessages(data);
    } catch (e) {}
  }

  async function fetchUnreadCount() {
    try {
      const res = await fetch('/api/global-chat-unread?user_email=' + encodeURIComponent(user.email) + '&company=' + encodeURIComponent(company));
      const data = await res.json();
      setUnreadCount(data.unread_count || 0);
      if (onUnreadChange) onUnreadChange(data.unread_mention_count || 0);
    } catch (e) {}
  }

  async function markAllAsRead() {
    if (!messages.length || !user?.email) return;
    try {
      await fetch('/api/global-chat-unread', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_email: user.email, message_ids: messages.map(m => m.id) }) });
      setUnreadCount(0);
      if (onUnreadChange) onUnreadChange(0);
    } catch (e) {}
  }

  async function searchFiles(query) {
    if (!query || query.length < 2) { setFileResults([]); return; }
    try {
      const res = await fetch('/api/claims?search=' + encodeURIComponent(query) + '&company=' + encodeURIComponent(company) + '&limit=8');
      const data = await res.json();
      if (Array.isArray(data)) setFileResults(data.map(c => ({ id: c.id, ref_number: c.ref_number, insured_name: c.insured_name })));
    } catch (e) { setFileResults([]); }
  }

  function handleMessageChange(e) {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setNewMessage(value);
    const textBeforeCursor = value.substring(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);
    if (atMatch) { setShowMentionDropdown(true); setMentionSearch(atMatch[1]); setMentionStartPos(atMatch.index); setShowFileDropdown(false); }
    else { setShowMentionDropdown(false); setMentionSearch(''); }
    const hashMatch = textBeforeCursor.match(/#([A-Za-z0-9/\-]*)$/);
    if (hashMatch) { setShowFileDropdown(true); setFileSearch(hashMatch[1]); setFileStartPos(hashMatch.index); setShowMentionDropdown(false); clearTimeout(fileSearchTimeout.current); fileSearchTimeout.current = setTimeout(() => searchFiles(hashMatch[1]), 300); }
    else { setShowFileDropdown(false); setFileSearch(''); }
  }

  function insertMention(selectedUser) {
    const before = newMessage.substring(0, mentionStartPos);
    const after = newMessage.substring(textareaRef.current?.selectionStart || mentionStartPos);
    setNewMessage(before + '@' + selectedUser.name + ' ' + after);
    setShowMentionDropdown(false);
    if (!mentionedUsers.includes(selectedUser.email)) { setMentionedUsers(prev => [...prev, selectedUser.email]); setMentionedNames(prev => [...prev, selectedUser.name]); }
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function removeMention(email) {
    const idx = mentionedUsers.indexOf(email);
    setMentionedUsers(prev => prev.filter(e => e !== email));
    setMentionedNames(prev => prev.filter((_, i) => i !== idx));
  }

  function insertFileTag(file) {
    const before = newMessage.substring(0, fileStartPos);
    const after = newMessage.substring(textareaRef.current?.selectionStart || fileStartPos);
    setNewMessage(before + '#' + file.ref_number + ' ' + after);
    setShowFileDropdown(false);
    if (!taggedFiles.find(f => f.ref_number === file.ref_number)) setTaggedFiles(prev => [...prev, file]);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function removeFileTag(refNumber) { setTaggedFiles(prev => prev.filter(f => f.ref_number !== refNumber)); }

  function getFilteredUsers() {
    if (!mentionSearch) return allUsers.slice(0, 8);
    const q = mentionSearch.toLowerCase();
    return allUsers.filter(u => u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)).slice(0, 8);
  }

  async function sendMessage() {
    if (!newMessage.trim() || sending) return;
    setSending(true);
    try {
      await fetch('/api/global-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: newMessage.trim(), sender_email: user.email, sender_name: user.name, mentioned_users: mentionedUsers, mentioned_names: mentionedNames, tagged_ref_numbers: taggedFiles.map(f => f.ref_number), company }) });
      setNewMessage(''); setMentionedUsers([]); setMentionedNames([]); setTaggedFiles([]);
      await loadMessages();
    } catch (e) { alert('Failed to send message'); }
    setSending(false);
  }

  function handleKeyDown(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }

  function renderMessage(text) {
    if (!text) return text;
    const parts = [];
    let lastIndex = 0;
    const regex = /@([A-Za-z\s]+?)(?=\s@|\s#|\s|$)|#([A-Za-z0-9/\-]+)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) parts.push(text.substring(lastIndex, match.index));
      if (match[1]) {
        parts.push(<span key={match.index} style={{ color: '#2563eb', fontWeight: 600, background: '#dbeafe', padding: '1px 4px', borderRadius: 3 }}>@{match[1]}</span>);
      } else if (match[2]) {
        const refNum = match[2];
        parts.push(<span key={match.index} onClick={(e) => { e.stopPropagation(); navigateToFile(refNum); }} style={{ color: '#059669', fontWeight: 600, background: '#d1fae5', padding: '1px 4px', borderRadius: 3, cursor: 'pointer', textDecoration: 'underline' }} title={'Open claim ' + refNum}>#{refNum}</span>);
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) parts.push(text.substring(lastIndex));
    return parts.length > 0 ? parts : text;
  }

  async function navigateToFile(refNumber) {
    try {
      const res = await fetch('/api/claims?search=' + encodeURIComponent(refNumber) + '&company=' + encodeURIComponent(company) + '&limit=1');
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) router.push('/claim-detail/' + data[0].id);
    } catch (e) {}
  }

  function formatTime(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function getInitials(name) { if (!name) return '?'; return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(); }

  const avatarColors = ['#1e3a5f', '#2d5016', '#7c3aed', '#b45309', '#dc2626', '#0891b2', '#be185d', '#4f46e5'];
  function getAvatarColor(email) { let hash = 0; for (let i = 0; i < (email || '').length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash); return avatarColors[Math.abs(hash) % avatarColors.length]; }

  if (!user) return null;

  return (
    <>
      <div onClick={() => setIsOpen(!isOpen)} style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 20px rgba(30,58,95,0.4)', transition: 'transform 0.2s, box-shadow 0.2s' }} onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; }} onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }} title="Team Chat">
        {isOpen ? (<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>) : (<svg width="26" height="26" viewBox="0 0 24 24" fill="#fff"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>)}
        {!isOpen && unreadCount > 0 && (<span style={{ position: 'absolute', top: -4, right: -4, background: '#dc2626', color: '#fff', fontSize: 10, fontWeight: 800, minWidth: 20, height: 20, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', border: '2px solid #fff' }}>{unreadCount > 99 ? '99+' : unreadCount}</span>)}
      </div>

      {isOpen && (
        <div style={{ position: 'fixed', bottom: 90, right: 24, zIndex: 9998, width: 380, maxHeight: 520, background: '#fff', borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #e5e7eb', animation: 'chatSlideUp 0.25s ease-out' }}>
          <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)', color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div><div style={{ fontWeight: 700, fontSize: 15 }}>Team Chat</div><div style={{ fontSize: 11, opacity: 0.8 }}>{messages.length} messages</div></div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>type @ for users, # for files</div>
          </div>

          <div ref={chatBodyRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', minHeight: 200, maxHeight: 300, background: '#f8fafc' }}>
            {messages.length === 0 && (<div style={{ textAlign: 'center', color: '#9ca3af', padding: 40, fontSize: 13 }}>No messages yet. Start the conversation!</div>)}
            {messages.map((msg, i) => {
              const isMe = msg.sender_email === user?.email;
              return (
                <div key={msg.id || i} style={{ marginBottom: 10, display: 'flex', gap: 8, flexDirection: isMe ? 'row-reverse' : 'row' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: getAvatarColor(msg.sender_email), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>{getInitials(msg.sender_name)}</div>
                  <div style={{ maxWidth: '72%' }}>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2, textAlign: isMe ? 'right' : 'left' }}>{isMe ? 'You' : msg.sender_name}<span style={{ marginLeft: 6, fontSize: 10, color: '#9ca3af' }}>{formatTime(msg.created_at)}</span></div>
                    <div style={{ background: isMe ? '#1e3a5f' : '#fff', color: isMe ? '#fff' : '#1f2937', padding: '8px 12px', borderRadius: 12, borderTopRightRadius: isMe ? 4 : 12, borderTopLeftRadius: isMe ? 12 : 4, fontSize: 13, lineHeight: 1.5, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', wordBreak: 'break-word' }}>{renderMessage(msg.message)}</div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {(mentionedUsers.length > 0 || taggedFiles.length > 0) && (
            <div style={{ padding: '4px 14px', background: '#f0f9ff', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {mentionedNames.map((name, i) => (<span key={'m-'+i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#dbeafe', color: '#1e40af', fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>@{name}<span onClick={() => removeMention(mentionedUsers[i])} style={{ cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>&times;</span></span>))}
              {taggedFiles.map((f, i) => (<span key={'f-'+i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#d1fae5', color: '#065f46', fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>#{f.ref_number}<span onClick={() => removeFileTag(f.ref_number)} style={{ cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>&times;</span></span>))}
            </div>
          )}

          {showMentionDropdown && (
            <div style={{ position: 'absolute', bottom: 70, left: 14, right: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 180, overflowY: 'auto', zIndex: 10 }}>
              <div style={{ padding: '6px 12px', fontSize: 11, color: '#9ca3af', borderBottom: '1px solid #f3f4f6' }}>Tag a user</div>
              {getFilteredUsers().map(u => (
                <div key={u.email} onClick={() => insertMention(u)} style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f9fafb' }} onMouseEnter={e => e.currentTarget.style.background = '#f0f9ff'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div><span style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</span><span style={{ marginLeft: 6, fontSize: 11, color: '#9ca3af' }}>{u.email?.split('@')[0]}</span></div>
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600, background: u.role === 'Admin' ? '#fef3c7' : u.role === 'Surveyor' ? '#dbeafe' : '#f3f4f6', color: u.role === 'Admin' ? '#92400e' : u.role === 'Surveyor' ? '#1e40af' : '#374151' }}>{u.role}</span>
                </div>
              ))}
              {getFilteredUsers().length === 0 && (<div style={{ padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>No users found</div>)}
            </div>
          )}

          {showFileDropdown && (
            <div style={{ position: 'absolute', bottom: 70, left: 14, right: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 180, overflowY: 'auto', zIndex: 10 }}>
              <div style={{ padding: '6px 12px', fontSize: 11, color: '#9ca3af', borderBottom: '1px solid #f3f4f6' }}>Tag a file (type ref number)</div>
              {fileResults.map(f => (
                <div key={f.id} onClick={() => insertFileTag(f)} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f9fafb' }} onMouseEnter={e => e.currentTarget.style.background = '#f0fdf4'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#059669' }}>{f.ref_number}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{f.insured_name || 'No insured name'}</div>
                </div>
              ))}
              {fileSearch.length >= 2 && fileResults.length === 0 && (<div style={{ padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>No files found</div>)}
              {fileSearch.length < 2 && (<div style={{ padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>Type at least 2 characters</div>)}
            </div>
          )}

          <div style={{ padding: '10px 14px', borderTop: '1px solid #e5e7eb', background: '#fff', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea ref={textareaRef} value={newMessage} onChange={handleMessageChange} onKeyDown={handleKeyDown} placeholder="Type a message... @ to tag users, # for files" rows={1} style={{ flex: 1, resize: 'none', border: '1px solid #d1d5db', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', fontFamily: 'inherit', lineHeight: 1.4, maxHeight: 80, overflowY: 'auto' }} onFocus={e => e.target.style.borderColor = '#2563eb'} onBlur={e => e.target.style.borderColor = '#d1d5db'} />
            <button onClick={sendMessage} disabled={!newMessage.trim() || sending} style={{ width: 36, height: 36, borderRadius: '50%', background: newMessage.trim() ? '#1e3a5f' : '#d1d5db', color: '#fff', border: 'none', cursor: newMessage.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.2s' }} title="Send">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes chatSlideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}

'use client';
import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LOB_LIST, LOB_ICONS, COMPANIES } from '@/lib/constants';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';
import GlobalChatBox from '@/components/GlobalChatBox';

export default function PageLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { company, setCompany } = useCompany();
  const { user, logout } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [globalChatMentionCount, setGlobalChatMentionCount] = useState(0);
  const companyLabel = COMPANIES.find(c => c.value === company)?.label || company;
  const isAllMode = company === 'All';
  const isDevMode = company === 'Development';

  // Notification dropdown state
  const [showNotifications, setShowNotifications] = useState(false);
  const [claimMentions, setClaimMentions] = useState([]);
  const [chatMentions, setChatMentions] = useState([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const notifRef = useRef(null);

  const totalBellCount = unreadCount + globalChatMentionCount;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotifications(false);
      }
    }
    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showNotifications]);

  // Fetch unread mention count for notification badge
  useEffect(() => {
    if (user?.email) {
      fetchUnreadCount();
      const interval = setInterval(fetchUnreadCount, 30000);
      return () => clearInterval(interval);
    }
  }, [user, company]);

  async function fetchUnreadCount() {
    try {
      const res = await fetch(`/api/unread-mentions?user_email=${encodeURIComponent(user.email)}&company=${encodeURIComponent(company)}`);
      const data = await res.json();
      setUnreadCount(data.unread_count || 0);
    } catch (e) { /* ignore */ }
  }

  async function fetchNotifications() {
    if (!user?.email) return;
    setLoadingNotifications(true);
    try {
      // Fetch claim mentions (unread)
      const claimRes = await fetch(`/api/unread-mentions?user_email=${encodeURIComponent(user.email)}&company=${encodeURIComponent(company)}`);
      const claimData = await claimRes.json();
      setClaimMentions((claimData.unread || []).slice(0, 20));

      // Fetch global chat mentions (unread)
      const chatRes = await fetch(`/api/global-chat-unread?user_email=${encodeURIComponent(user.email)}&company=${encodeURIComponent(company)}&include_messages=true`);
      const chatData = await chatRes.json();
      setChatMentions((chatData.unread_mentions || []).slice(0, 20));
    } catch (e) { /* ignore */ }
    setLoadingNotifications(false);
  }

  function handleBellClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!showNotifications) {
      fetchNotifications();
    }
    setShowNotifications(!showNotifications);
  }

  async function handleMarkClaimRead(msg) {
    try {
      await fetch('/api/unread-mentions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: user.email, message_id: msg.id }),
      });
      setClaimMentions(prev => prev.filter(m => m.id !== msg.id));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (e) {}
    // Navigate to the claim
    if (msg.claim_id) {
      router.push(`/claim-detail/${msg.claim_id}`);
      setShowNotifications(false);
    }
  }

  async function handleMarkAllRead() {
    try {
      await fetch('/api/unread-mentions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: user.email, mark_all: true }),
      });
      setClaimMentions([]);
      setUnreadCount(0);
    } catch (e) {}
  }

  function formatTimeShort(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  const badgeColor = company === 'NISLA' ? '#1e3a5f' : company === 'Acuere' ? '#2d5016' : company === 'Development' ? '#b45309' : '#7c3aed';

  return (
    <>
      <header>
        <div className="header-content">
          <h1>Insurance Claims MIS</h1>
          <div className="header-right">
            <select
              className="company-selector"
              value={company}
              onChange={e => setCompany(e.target.value)}
            >
              {COMPANIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <nav>
              <Link href="/">Dashboard</Link>
              {!isAllMode && <Link href="/claim-registration">Claim Registration</Link>}
              <Link href="/mis-portal">MIS Portal</Link>
              {!isAllMode && <Link href="/workflow-overview">Workflow</Link>}
              {!isAllMode && <Link href="/file-assignments">Assignments</Link>}
              {!isAllMode && user?.role === 'Admin' && <Link href="/user-management">Users</Link>}
            </nav>
            {user && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 15, borderLeft: '1px solid rgba(255,255,255,0.3)', paddingLeft: 15 }}>
                <div ref={notifRef} style={{ position: 'relative' }}>
                  <div
                    onClick={handleBellClick}
                    style={{ position: 'relative', cursor: 'pointer', marginRight: 4, userSelect: 'none' }}
                    title={totalBellCount > 0 ? `${totalBellCount} unread notifications` : 'No unread notifications'}
                  >
                    <span style={{ fontSize: 18 }}>&#x1F514;</span>
                    {totalBellCount > 0 && (
                      <span style={{
                        position: 'absolute', top: -6, right: -8,
                        background: '#dc2626', color: '#fff',
                        fontSize: 9, fontWeight: 800, minWidth: 16, height: 16,
                        borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0 4px', border: '2px solid #1e3a5f',
                      }}>
                        {totalBellCount > 9 ? '9+' : totalBellCount}
                      </span>
                    )}
                  </div>

                  {/* Notification Dropdown */}
                  {showNotifications && (
                    <div style={{
                      position: 'absolute', top: 32, right: -60, width: 380, maxHeight: 480,
                      background: '#fff', borderRadius: 12, boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
                      zIndex: 10000, overflow: 'hidden', border: '1px solid #e5e7eb',
                    }}>
                      {/* Header */}
                      <div style={{
                        background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)',
                        color: '#fff', padding: '12px 16px',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>Notifications</div>
                        {(claimMentions.length > 0) && (
                          <button
                            onClick={handleMarkAllRead}
                            style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                          >
                            Mark all read
                          </button>
                        )}
                      </div>

                      {/* Body */}
                      <div style={{ overflowY: 'auto', maxHeight: 420 }}>
                        {loadingNotifications && (
                          <div style={{ padding: 30, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Loading...</div>
                        )}

                        {!loadingNotifications && claimMentions.length === 0 && chatMentions.length === 0 && (
                          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                            No unread notifications
                          </div>
                        )}

                        {/* Claim Mentions Section */}
                        {claimMentions.length > 0 && (
                          <>
                            <div style={{ padding: '8px 16px', fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f9fafb', borderBottom: '1px solid #f3f4f6', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                              Claim Mentions ({claimMentions.length})
                            </div>
                            {claimMentions.map(msg => (
                              <div
                                key={'claim-' + msg.id}
                                onClick={() => handleMarkClaimRead(msg)}
                                style={{
                                  padding: '10px 16px', cursor: 'pointer',
                                  borderBottom: '1px solid #f3f4f6',
                                  display: 'flex', gap: 10, alignItems: 'flex-start',
                                  background: '#eff6ff',
                                  transition: 'background 0.15s',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = '#dbeafe'}
                                onMouseLeave={e => e.currentTarget.style.background = '#eff6ff'}
                              >
                                <div style={{
                                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                                  background: '#1e3a5f', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  color: '#fff', fontSize: 11, fontWeight: 700,
                                }}>
                                  {getInitials(msg.sender_name)}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ fontWeight: 700, fontSize: 12, color: '#1f2937' }}>{msg.sender_name || 'Unknown'}</span>
                                    <span style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>{formatTimeShort(msg.created_at)}</span>
                                  </div>
                                  {msg.ref_number && (
                                    <div style={{ fontSize: 10, color: '#2563eb', fontWeight: 600, marginBottom: 2 }}>
                                      &#x1F4C4; {msg.ref_number}
                                    </div>
                                  )}
                                  <div style={{
                                    fontSize: 12, color: '#4b5563', lineHeight: 1.4,
                                    overflow: 'hidden', textOverflow: 'ellipsis',
                                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                                  }}>
                                    {msg.message?.substring(0, 120)}{msg.message?.length > 120 ? '...' : ''}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </>
                        )}

                        {/* Global Chat Mentions Section */}
                        {chatMentions.length > 0 && (
                          <>
                            <div style={{ padding: '8px 16px', fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f9fafb', borderBottom: '1px solid #f3f4f6', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                              Chat Mentions ({chatMentions.length})
                            </div>
                            {chatMentions.map(msg => (
                              <div
                                key={'chat-' + msg.id}
                                style={{
                                  padding: '10px 16px',
                                  borderBottom: '1px solid #f3f4f6',
                                  display: 'flex', gap: 10, alignItems: 'flex-start',
                                  background: '#fefce8',
                                }}
                              >
                                <div style={{
                                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                                  background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  color: '#fff', fontSize: 11, fontWeight: 700,
                                }}>
                                  {getInitials(msg.sender_name)}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ fontWeight: 700, fontSize: 12, color: '#1f2937' }}>{msg.sender_name || 'Unknown'}</span>
                                    <span style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>{formatTimeShort(msg.created_at)}</span>
                                  </div>
                                  <div style={{
                                    fontSize: 12, color: '#4b5563', lineHeight: 1.4,
                                    overflow: 'hidden', textOverflow: 'ellipsis',
                                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                                  }}>
                                    {msg.message?.substring(0, 120)}{msg.message?.length > 120 ? '...' : ''}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)' }}>{user.name}</span>
                <button onClick={logout} style={{ padding: '4px 12px', fontSize: 11, background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, cursor: 'pointer' }}>Logout</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="layout-wrapper">
        <div className="sidebar">
          <div className="sidebar-content">
            <div className="company-badge" style={{ padding: '10px 15px', marginBottom: 10, background: badgeColor, borderRadius: 8, color: '#fff', textAlign: 'center', fontSize: 12, fontWeight: 600 }}>
              {companyLabel}
              {isAllMode && <div style={{ fontSize: 10, marginTop: 4, opacity: 0.8 }}>Read-Only Mode</div>}
              {isDevMode && <div style={{ fontSize: 10, marginTop: 4, opacity: 0.8 }}>Testing & New Features</div>}
            </div>
            <div className="nav-section">
              <Link href="/" className={`nav-item ${pathname === '/' ? 'active' : ''}`}>
                <span className="nav-icon">&#x1F4CA;</span><span>Dashboard</span>
              </Link>
            </div>
            {!isAllMode && (
              <div className="nav-section">
                <Link href="/claim-registration" className={`nav-item primary ${pathname === '/claim-registration' ? 'active' : ''}`}>
                  <span className="nav-icon">&#x1F4DD;</span><span>Claim Registration</span>
                </Link>
              </div>
            )}
            <div className="nav-section">
              <Link href="/mis-portal" className={`nav-item ${pathname === '/mis-portal' ? 'active' : ''}`}>
                <span className="nav-icon">&#x1F4C8;</span><span>MIS Portal</span>
              </Link>
            </div>
            {!isAllMode && (
              <>
                <div className="nav-section">
                  <div className="nav-section-title">Masters</div>
                  <Link href="/insurer-master" className={`nav-item ${pathname === '/insurer-master' ? 'active' : ''}`}>
                    <span className="nav-icon">&#x1F3E2;</span><span>Insurer Master</span>
                  </Link>
                  <Link href="/policy-master" className={`nav-item ${pathname === '/policy-master' ? 'active' : ''}`}>
                    <span className="nav-icon">&#x1F4CB;</span><span>Policy Master</span>
                  </Link>
                  <Link href="/broker-master" className={`nav-item ${pathname === '/broker-master' ? 'active' : ''}`}>
                    <span className="nav-icon">&#x1F91D;</span><span>Broker Master</span>
                  </Link>
                  <Link href="/policy-directory" className={`nav-item ${pathname === '/policy-directory' ? 'active' : ''}`}>
                    <span className="nav-icon">&#x1F4C1;</span><span>Policy Directory</span>
                  </Link>
                  <Link href="/ref-number-portal" className={`nav-item ${pathname === '/ref-number-portal' ? 'active' : ''}`}>
                    <span className="nav-icon">&#x1F522;</span><span>Ref Number Portal</span>
                  </Link>
                </div>
                <div className="nav-section">
                  <div className="nav-section-title">Workflow</div>
                  <Link href="/workflow-overview" className={`nav-item ${pathname === '/workflow-overview' ? 'active' : ''}`}>
                    <span className="nav-icon">&#x1F504;</span><span>Workflow Overview</span>
                  </Link>
                </div>
                <div className="nav-section">
                  <div className="nav-section-title">Documents</div>
                  <Link href="/lor-ila-generator" className={`nav-item ${pathname === '/lor-ila-generator' ? 'active' : ''}`}>
                    <span className="nav-icon">&#x1F4C4;</span><span>LOR / ILA Generator</span>
                  </Link>
                  <Link href="/file-tracking" className={`nav-item ${pathname === '/file-tracking' ? 'active' : ''}`}>
                    <span className="nav-icon">&#x1F4C2;</span><span>File Tracking</span>
                  </Link>
                  <Link href="/file-assignments" className={`nav-item ${pathname === '/file-assignments' ? 'active' : ''}`}>
                    <span className="nav-icon">&#x1F4CE;</span><span>File Assignments</span>
                  </Link>
                </div>
                {user?.role === 'Admin' && (
                  <div className="nav-section">
                    <div className="nav-section-title">Admin</div>
                    <Link href="/user-management" className={`nav-item ${pathname === '/user-management' ? 'active' : ''}`}>
                      <span className="nav-icon">&#x1F465;</span><span>User Management</span>
                    </Link>
                    <Link href="/activity-log" className={`nav-item ${pathname === '/activity-log' ? 'active' : ''}`}>
                      <span className="nav-icon">&#x1F4CB;</span><span>Activity Log</span>
                    </Link>
                    <Link href="/user-monitoring" className={`nav-item ${pathname === '/user-monitoring' ? 'active' : ''}`}>
                      <span className="nav-icon">&#x1F441;</span><span>User Monitoring</span>
                    </Link>
                  </div>
                )}
                <div className="nav-section">
                  <div className="nav-section-title">Billing</div>
                  <Link href="/survey-fee-bill" className={`nav-item ${pathname === '/survey-fee-bill' ? 'active' : ''}`}>
                    <span className="nav-icon">&#x1F9FE;</span><span>Survey Fee Bill</span>
                  </Link>
                </div>
                <div className="nav-section">
                  <div className="nav-section-title">System</div>
                  <Link href="/backup" className={`nav-item ${pathname === '/backup' ? 'active' : ''}`}>
                    <span className="nav-icon">&#x1F4BE;</span><span>Data Backup</span>
                  </Link>
                </div>
                <div className="nav-section">
                  <div className="nav-section-title">Claims by LOB</div>
                  {LOB_LIST.map(lob => (
                    <Link key={lob} href={`/claims/${encodeURIComponent(lob)}`}
                      className={`nav-item ${pathname.includes(encodeURIComponent(lob)) ? 'active' : ''}`}>
                      <span className="nav-icon">{LOB_ICONS[lob]}</span><span>{lob}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="main-content-wrapper">
          <div className="container">
            {children}
          </div>
        </div>
      </div>

      {user && <GlobalChatBox onUnreadChange={setGlobalChatMentionCount} />}
    </>
  );
}

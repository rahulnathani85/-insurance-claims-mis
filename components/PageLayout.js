'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { LOB_LIST, LOB_COLORS, COMPANIES } from '@/lib/constants';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';
import GlobalChatBox from '@/components/GlobalChatBox';

// Colorful icon component for sidebar
function SideIcon({ letter, bg, color }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 22, height: 22, borderRadius: 6, fontSize: 11, fontWeight: 700,
      background: bg, color: color, flexShrink: 0, lineHeight: 1,
    }}>
      {letter}
    </span>
  );
}

// LOB colored dot icon
function LobDot({ color }) {
  return (
    <span style={{
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
      background: color, flexShrink: 0, marginRight: 2,
    }} />
  );
}

export default function PageLayout({ children }) {
  const pathname = usePathname();
  const { company, setCompany } = useCompany();
  const { user, logout } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [globalChatMentionCount, setGlobalChatMentionCount] = useState(0);
  const companyLabel = COMPANIES.find(c => c.value === company)?.label || company;
  const isAllMode = company === 'All';
  const isDevMode = company === 'Development';

  const totalBellCount = unreadCount + globalChatMentionCount;

  // Fetch unread mention count for notification badge
  useEffect(() => {
    if (user?.email) {
      fetchUnreadCount();
      const interval = setInterval(fetchUnreadCount, 30000); // Poll every 30s
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
                <Link href="/" style={{ position: 'relative', textDecoration: 'none', cursor: 'pointer', marginRight: 4 }} title={totalBellCount > 0 ? `${totalBellCount} unread (${unreadCount} claim mentions + ${globalChatMentionCount} chat mentions)` : 'No unread mentions'}>
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
                </Link>
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
                <SideIcon letter="D" bg="#dbeafe" color="#1d4ed8" /><span>Dashboard</span>
              </Link>
            </div>
            {!isAllMode && (
              <div className="nav-section">
                <Link href="/claim-registration" className={`nav-item primary ${pathname === '/claim-registration' ? 'active' : ''}`}>
                  <SideIcon letter="+" bg="#1e3a5f" color="#fff" /><span>Claim Registration</span>
                </Link>
              </div>
            )}

            {/* Extended Warranty Section */}
            {!isAllMode && (
              <div className="nav-section">
                <div className="nav-section-title">Extended Warranty</div>
                <Link href="/ew-vehicle-claims" className={`nav-item ${pathname.startsWith('/ew-vehicle-claims') ? 'active' : ''}`}>
                  <SideIcon letter="EW" bg="#ede9fe" color="#7c3aed" /><span>EW Vehicle Claims</span>
                </Link>
              </div>
            )}

            <div className="nav-section">
              <Link href="/mis-portal" className={`nav-item ${pathname === '/mis-portal' ? 'active' : ''}`}>
                <SideIcon letter="M" bg="#dcfce7" color="#15803d" /><span>MIS Portal</span>
              </Link>
            </div>
            {!isAllMode && (
              <>
                <div className="nav-section">
                  <div className="nav-section-title">Masters</div>
                  <Link href="/insurer-master" className={`nav-item ${pathname === '/insurer-master' ? 'active' : ''}`}>
                    <SideIcon letter="IN" bg="#fef3c7" color="#b45309" /><span>Insurer Master</span>
                  </Link>
                  <Link href="/policy-master" className={`nav-item ${pathname === '/policy-master' ? 'active' : ''}`}>
                    <SideIcon letter="PM" bg="#fce7f3" color="#be185d" /><span>Policy Master</span>
                  </Link>
                  <Link href="/broker-master" className={`nav-item ${pathname === '/broker-master' ? 'active' : ''}`}>
                    <SideIcon letter="BM" bg="#e0e7ff" color="#4338ca" /><span>Broker Master</span>
                  </Link>
                  <Link href="/policy-directory" className={`nav-item ${pathname === '/policy-directory' ? 'active' : ''}`}>
                    <SideIcon letter="PD" bg="#cffafe" color="#0e7490" /><span>Policy Directory</span>
                  </Link>
                  <Link href="/ref-number-portal" className={`nav-item ${pathname === '/ref-number-portal' ? 'active' : ''}`}>
                    <SideIcon letter="R#" bg="#f3e8ff" color="#7e22ce" /><span>Ref Number Portal</span>
                  </Link>
                </div>
                <div className="nav-section">
                  <div className="nav-section-title">Workflow</div>
                  <Link href="/workflow-overview" className={`nav-item ${pathname === '/workflow-overview' ? 'active' : ''}`}>
                    <SideIcon letter="WF" bg="#dbeafe" color="#1e40af" /><span>Workflow Overview</span>
                  </Link>
                </div>
                <div className="nav-section">
                  <div className="nav-section-title">Documents</div>
                  <Link href="/lor-ila-generator" className={`nav-item ${pathname === '/lor-ila-generator' ? 'active' : ''}`}>
                    <SideIcon letter="LI" bg="#fef9c3" color="#a16207" /><span>LOR / ILA Generator</span>
                  </Link>
                  <Link href="/file-tracking" className={`nav-item ${pathname === '/file-tracking' ? 'active' : ''}`}>
                    <SideIcon letter="FT" bg="#d1fae5" color="#047857" /><span>File Tracking</span>
                  </Link>
                  <Link href="/file-assignments" className={`nav-item ${pathname === '/file-assignments' ? 'active' : ''}`}>
                    <SideIcon letter="FA" bg="#ffe4e6" color="#be123c" /><span>File Assignments</span>
                  </Link>
                </div>
                {user?.role === 'Admin' && (
                  <div className="nav-section">
                    <div className="nav-section-title">Admin</div>
                    <Link href="/user-management" className={`nav-item ${pathname === '/user-management' ? 'active' : ''}`}>
                      <SideIcon letter="UM" bg="#e0e7ff" color="#3730a3" /><span>User Management</span>
                    </Link>
                    <Link href="/activity-log" className={`nav-item ${pathname === '/activity-log' ? 'active' : ''}`}>
                      <SideIcon letter="AL" bg="#fef3c7" color="#92400e" /><span>Activity Log</span>
                    </Link>
                    <Link href="/user-monitoring" className={`nav-item ${pathname === '/user-monitoring' ? 'active' : ''}`}>
                      <SideIcon letter="UM" bg="#fce7f3" color="#9d174d" /><span>User Monitoring</span>
                    </Link>
                  </div>
                )}
                <div className="nav-section">
                  <div className="nav-section-title">Billing</div>
                  <Link href="/survey-fee-bill" className={`nav-item ${pathname === '/survey-fee-bill' ? 'active' : ''}`}>
                    <SideIcon letter="SF" bg="#dcfce7" color="#166534" /><span>Survey Fee Bill</span>
                  </Link>
                </div>
                <div className="nav-section">
                  <div className="nav-section-title">System</div>
                  <Link href="/backup" className={`nav-item ${pathname === '/backup' ? 'active' : ''}`}>
                    <SideIcon letter="DB" bg="#f1f5f9" color="#475569" /><span>Data Backup</span>
                  </Link>
                </div>
                <div className="nav-section">
                  <div className="nav-section-title">Claims by LOB</div>
                  {LOB_LIST.map(lob => (
                    <Link key={lob} href={`/claims/${encodeURIComponent(lob)}`}
                      className={`nav-item ${pathname.includes(encodeURIComponent(lob)) ? 'active' : ''}`}>
                      <LobDot color={LOB_COLORS[lob] || '#64748b'} /><span>{lob}</span>
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

      {/* Global Team Chat - floating bottom-right on every page */}
      {user && <GlobalChatBox onUnreadChange={setGlobalChatMentionCount} />}
    </>
  );
}

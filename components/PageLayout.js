'use client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { LOB_LIST, LOB_ICONS, COMPANIES } from '@/lib/constants';
import { useCompany } from '@/lib/CompanyContext';

export default function PageLayout({ children }) {
  const pathname = usePathname();
  const { company, setCompany } = useCompany();
  const companyLabel = COMPANIES.find(c => c.value === company)?.label || company;
  const isAllMode = company === 'All';
  const isDevMode = company === 'Development';

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
              {!isAllMode && <Link href="/insurer-master">Insurers</Link>}
              {!isAllMode && <Link href="/policy-master">Policies</Link>}
              {!isAllMode && <Link href="/survey-fee-bill">Survey Fee</Link>}
              {!isAllMode && <Link href="/policy-directory">Policy Directory</Link>}
              {!isAllMode && <Link href="/ref-number-portal">Ref Numbers</Link>}
            </nav>
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
                <span className="nav-icon">📊</span><span>Dashboard</span>
              </Link>
            </div>
            {!isAllMode && (
              <div className="nav-section">
                <Link href="/claim-registration" className={`nav-item primary ${pathname === '/claim-registration' ? 'active' : ''}`}>
                  <span className="nav-icon">📝</span><span>Claim Registration</span>
                </Link>
              </div>
            )}
            <div className="nav-section">
              <Link href="/mis-portal" className={`nav-item ${pathname === '/mis-portal' ? 'active' : ''}`}>
                <span className="nav-icon">📈</span><span>MIS Portal</span>
              </Link>
            </div>
            {!isAllMode && (
              <>
                <div className="nav-section">
                  <div className="nav-section-title">Masters</div>
                  <Link href="/insurer-master" className={`nav-item ${pathname === '/insurer-master' ? 'active' : ''}`}>
                    <span className="nav-icon">🏢</span><span>Insurer Master</span>
                  </Link>
                  <Link href="/policy-master" className={`nav-item ${pathname === '/policy-master' ? 'active' : ''}`}>
                    <span className="nav-icon">📋</span><span>Policy Master</span>
                  </Link>
                  <Link href="/policy-directory" className={`nav-item ${pathname === '/policy-directory' ? 'active' : ''}`}>
                    <span className="nav-icon">📁</span><span>Policy Directory</span>
                  </Link>
                  <Link href="/ref-number-portal" className={`nav-item ${pathname === '/ref-number-portal' ? 'active' : ''}`}>
                    <span className="nav-icon">🔢</span><span>Ref Number Portal</span>
                  </Link>
                </div>
                <div className="nav-section">
                  <div className="nav-section-title">Billing</div>
                  <Link href="/survey-fee-bill" className={`nav-item ${pathname === '/survey-fee-bill' ? 'active' : ''}`}>
                    <span className="nav-icon">🧾</span><span>Survey Fee Bill</span>
                  </Link>
                </div>
                <div className="nav-section">
                  <div className="nav-section-title">System</div>
                  <Link href="/backup" className={`nav-item ${pathname === '/backup' ? 'active' : ''}`}>
                    <span className="nav-icon">💾</span><span>Data Backup</span>
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
    </>
  );
}

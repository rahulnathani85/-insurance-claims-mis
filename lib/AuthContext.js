'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const AuthContext = createContext();

// Phase-2 portal-segregation rules:
//   - insurer_readonly users live entirely under /insurer-portal/*. Any
//     attempt to navigate to a surveyor route bumps them back to
//     /insurer-portal.
//   - Surveyor / Admin / Staff users see /insurer-portal as a 404 — the
//     pages exist but the guard pushes them away. Reduces accidental
//     "I clicked the wrong link" leakage of insurer-shaped UI.
//   - /login is always reachable.
const INSURER_ROLE = 'insurer_readonly';
const INSURER_PATH_PREFIX = '/insurer-portal';

function isInsurerPath(pathname) {
  return pathname === INSURER_PATH_PREFIX || pathname?.startsWith(INSURER_PATH_PREFIX + '/');
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') { setLoading(false); return; }
    // ONLY sessionStorage controls the active login session
    // localStorage just remembers WHO last logged in (for the login page to display)
    const session = sessionStorage.getItem('mis_user');
    if (session) {
      try {
        const parsed = JSON.parse(session);
        setUser(parsed);
        // Also ensure remembered user is saved for next time
        localStorage.setItem('mis_remembered_user', session);
      } catch (e) {
        sessionStorage.removeItem('mis_user');
      }
    }
    setLoading(false);
  }, []);

  // Redirect to login if not authenticated (except on /login page)
  useEffect(() => {
    if (!loading && !user && pathname !== '/login') {
      router.push('/login');
    }
  }, [loading, user, pathname, router]);

  // Phase-2 portal segregation. Runs after auth load so we know the
  // user's role.
  useEffect(() => {
    if (loading || !user || pathname === '/login') return;
    const isInsurer = user.role === INSURER_ROLE;
    if (isInsurer && !isInsurerPath(pathname)) {
      router.push(INSURER_PATH_PREFIX);
    } else if (!isInsurer && isInsurerPath(pathname)) {
      router.push('/');
    }
  }, [loading, user, pathname, router]);

  const login = async (username, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (res.ok) {
      setUser(data.user);
      // sessionStorage = active session (cleared when browser closes)
      sessionStorage.setItem('mis_user', JSON.stringify(data.user));
      // localStorage = remember this user on this system (persists forever)
      localStorage.setItem('mis_remembered_user', JSON.stringify(data.user));
      // Phase 2: insurer-readonly users go to /insurer-portal; surveyors
      // hit the regular dashboard ('/'). The login page can also read
      // data.redirect_to and route there directly so the user doesn't
      // see a flash of the wrong dashboard before the segregation guard
      // bumps them.
      return { success: true, redirect_to: data.redirect_to || '/' };
    }
    return { success: false, error: data.error };
  };

  const logout = () => {
    setUser(null);
    sessionStorage.removeItem('mis_user');
    // Keep mis_remembered_user in localStorage — so login page still shows "Welcome back"
    router.push('/login');
  };

  // Show nothing while checking auth (prevents flash of content)
  if (loading) {
    return (
      <AuthContext.Provider value={{ user, loading, login, logout }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
          <p style={{ color: '#6b7280', fontSize: 14 }}>Loading...</p>
        </div>
      </AuthContext.Provider>
    );
  }

  // If not logged in and not on login page, show nothing (redirect is happening)
  if (!user && pathname !== '/login') {
    return (
      <AuthContext.Provider value={{ user, loading, login, logout }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
          <p style={{ color: '#6b7280', fontSize: 14 }}>Redirecting to login...</p>
        </div>
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

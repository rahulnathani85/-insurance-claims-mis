'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? sessionStorage.getItem('mis_user') : null;
    if (stored) {
      try {
        setUser(JSON.parse(stored));
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

  const login = async (username, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (res.ok) {
      setUser(data.user);
      sessionStorage.setItem('mis_user', JSON.stringify(data.user));
      return { success: true };
    }
    return { success: false, error: data.error };
  };

  const logout = () => {
    setUser(null);
    sessionStorage.removeItem('mis_user');
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

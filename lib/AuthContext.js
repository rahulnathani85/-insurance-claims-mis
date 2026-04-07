'use client';
import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for stored session
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

  const login = async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
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
  };

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

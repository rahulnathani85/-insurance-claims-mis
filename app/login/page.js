'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberedUser, setRememberedUser] = useState(null);
  const [switchingUser, setSwitchingUser] = useState(false);
  const { login, user } = useAuth();
  const router = useRouter();

  // If already logged in (active session exists), go to dashboard
  useEffect(() => {
    if (user) router.push('/');
  }, [user]);

  // Check localStorage for remembered user on this system
  useEffect(() => {
    try {
      const stored = localStorage.getItem('mis_remembered_user');
      if (stored) {
        setRememberedUser(JSON.parse(stored));
      }
    } catch (e) { /* ignore */ }
  }, []);

  // Quick login — remembered user just enters password
  const handleQuickLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(rememberedUser.name || rememberedUser.email, password);
    setLoading(false);
    if (result.success) {
      router.push('/');
    } else {
      setError(result.error || 'Login failed');
    }
  };

  // Full login — different user enters username + password
  const handleFullLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(username, password);
    setLoading(false);
    if (result.success) {
      router.push('/');
    } else {
      setError(result.error || 'Login failed');
    }
  };

  const handleSwitchUser = () => {
    setSwitchingUser(true);
    setUsername('');
    setPassword('');
    setError('');
  };

  const handleBackToSaved = () => {
    setSwitchingUser(false);
    setPassword('');
    setError('');
  };

  // Get initials for avatar
  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  };

  // Show quick-login if there's a remembered user and we're not switching
  const showQuickLogin = rememberedUser && !switchingUser;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #1e3a5f 0%, #2d5016 100%)' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 40, width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <h1 style={{ fontSize: 24, color: '#1e3a5f', margin: 0 }}>Insurance Claims MIS</h1>
          <p style={{ color: '#666', fontSize: 14, marginTop: 8 }}>
            {showQuickLogin ? 'Welcome back' : 'Sign in to continue'}
          </p>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 15px', borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
            {error}
          </div>
        )}

        {showQuickLogin ? (
          /* Quick Login — remembered user on this system, just needs password */
          <form onSubmit={handleQuickLogin}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', background: '#1e3a5f',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, fontWeight: 700, margin: '0 auto 12px',
              }}>
                {getInitials(rememberedUser.name)}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1e3a5f' }}>{rememberedUser.name}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{rememberedUser.email}</div>
              {rememberedUser.role && (
                <span style={{ display: 'inline-block', marginTop: 6, padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: '#e0e7ff', color: '#3730a3' }}>
                  {rememberedUser.role}
                </span>
              )}
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoFocus
                  style={{ width: '100%', padding: '10px 14px', paddingRight: 50, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                  placeholder="Enter password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
                    color: '#6b7280', padding: '2px 6px', fontWeight: 500
                  }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', padding: '12px', background: '#1e3a5f', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button
                type="button"
                onClick={handleSwitchUser}
                style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: 13, cursor: 'pointer', fontWeight: 500, textDecoration: 'underline' }}
              >
                Sign in as a different user
              </button>
            </div>
          </form>
        ) : (
          /* Full Login — enter username + password */
          <form onSubmit={handleFullLogin}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>User ID</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                style={{ width: '100%', padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                placeholder="e.g. Rahul Nathani"
                autoComplete="username"
                autoFocus
              />
            </div>
            <div style={{ marginBottom: 25 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  style={{ width: '100%', padding: '10px 14px', paddingRight: 50, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                  placeholder="Enter password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
                    color: '#6b7280', padding: '2px 6px', fontWeight: 500
                  }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', padding: '12px', background: '#1e3a5f', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            {/* Show "Back" link if they came from switch user */}
            {rememberedUser && (
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <button
                  type="button"
                  onClick={handleBackToSaved}
                  style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
                >
                  Back to {rememberedUser.name}
                </button>
              </div>
            )}
          </form>
        )}

        <p style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af', marginTop: 20 }}>
          NISLA &middot; Nathani Insurance Surveyors
        </p>
      </div>
    </div>
  );
}

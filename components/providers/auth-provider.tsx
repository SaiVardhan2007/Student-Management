'use client';

// Provides the signed-in user and login/register/logout functions to the app via useAuth().

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, sessionHint, refreshSession, setSessionExpiredHandler } from '@/lib/api-client';
import { setCacheOwner } from '@/hooks';

const AuthContext = createContext<any>(null);

/**
 * Holds the signed-in user. The server layout verifies the session cookie and passes `initialUser`, so protected pages
 * render signed-in on first paint. When the short-lived access token has expired, the provider restores the session
 * through the refresh cookie instead.
 */
export function AuthProvider({
  children,
  initialUser = null,
  initialProfile = null,
}: {
  children: React.ReactNode;
  initialUser?: any;
  initialProfile?: any;
}) {
  const [user, setUser] = useState<any>(initialUser);
  const [profile, setProfile] = useState<any>(initialProfile);
  // Loading only while we may still be able to restore a session (see the effect below)
  const [loading, setLoading] = useState(!initialUser && sessionHint.has);
  // Cached responses belong to one user: drop them when it changes. Done during render (it is idempotent) so the
  // pages below never read another user's cache.
  if (typeof window !== 'undefined' && !loading) setCacheOwner(user?._id ? String(user._id) : null);

  const clear = useCallback(() => {
    sessionHint.clear();
    setUser(null);
    setProfile(null);
  }, []);

  // If the API client cannot refresh the session any more, sign the user out here too
  useEffect(() => {
    setSessionExpiredHandler(clear);
  }, [clear]);

  useEffect(() => {
    if (initialUser) {
      sessionHint.set();
      return;
    }
    if (!sessionHint.has) {
      setLoading(false);
      return;
    }
    // the access token expired (or this is a fresh tab): restore the session through the refresh cookie
    refreshSession()
      .then(() => api.get('/auth/me'))
      .then((res) => {
        setUser(res.data.data.user);
        setProfile(res.data.data.profile);
      })
      .catch(() => clear())
      .finally(() => setLoading(false));
  }, [initialUser, clear]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    const { user: u, profile: p } = res.data.data;
    sessionHint.set();
    setUser(u);
    setProfile(p);
    return u;
  }, []);

  const register = useCallback(async (payload: Record<string, any>) => {
    const res = await api.post('/auth/register', payload);
    // faculty sign-ups are not signed in: they wait for admin approval
    if (res.data.data?.pending) return { pending: true, message: res.data.message };
    const { user: u, profile: p } = res.data.data;
    sessionHint.set();
    setUser(u);
    setProfile(p);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* already signed out */
    }
    clear();
    // a full navigation drops every cached server render of the signed-in app
    window.location.assign('/login');
  }, [clear]);

  const refreshUser = useCallback(async () => {
    const res = await api.get('/auth/me');
    setUser(res.data.data.user);
    setProfile(res.data.data.profile);
  }, []);

  const value = useMemo(
    () => ({
      user,
      profile,
      loading,
      login,
      register,
      logout,
      refreshUser,
      setUser,
      hasRole: (...r: string[]) => !!user && r.includes(user.role),
    }),
    [user, profile, loading, login, register, logout, refreshUser]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Access the auth state: const { user, login, logout, hasRole } = useAuth(); */
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};

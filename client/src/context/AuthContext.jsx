import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore, setSessionExpiredHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(!!tokenStore.access);

  const clear = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setProfile(null);
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(clear);
  }, [clear]);

  useEffect(() => {
    if (!tokenStore.access) return;
    api.get('/auth/me')
      .then((res) => { setUser(res.data.data.user); setProfile(res.data.data.profile); })
      .catch(() => clear())
      .finally(() => setLoading(false));
  }, [clear]);

  const login = useCallback(async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    const { user: u, profile: p, ...tokens } = res.data.data;
    tokenStore.set(tokens);
    setUser(u);
    setProfile(p);
    return u;
  }, []);

  const register = useCallback(async (payload) => {
    const res = await api.post('/auth/register', payload);
    const { user: u, profile: p, ...tokens } = res.data.data;
    tokenStore.set(tokens);
    setUser(u);
    setProfile(p);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout', { refreshToken: tokenStore.refresh }); } catch { /* already signed out */ }
    clear();
  }, [clear]);

  const refreshUser = useCallback(async () => {
    const res = await api.get('/auth/me');
    setUser(res.data.data.user);
    setProfile(res.data.data.profile);
  }, []);

  const value = useMemo(
    () => ({ user, profile, loading, login, register, logout, refreshUser, setUser, hasRole: (...r) => !!user && r.includes(user.role) }),
    [user, profile, loading, login, register, logout, refreshUser]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};

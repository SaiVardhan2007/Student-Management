import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

const SettingsContext = createContext({ settings: { collegeName: 'Student Management System' }, reload: () => {} });

export function SettingsProvider({ children }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState({ collegeName: 'Student Management System' });

  const reload = useCallback(async () => {
    try {
      const res = await api.get(user ? '/settings' : '/settings/public');
      setSettings((s) => ({ ...s, ...res.data.data }));
    } catch {
      /* branding is optional; keep defaults */
    }
  }, [user]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { document.title = settings.collegeName || 'Student Management System'; }, [settings.collegeName]);

  const value = useMemo(() => ({ settings, reload }), [settings, reload]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);

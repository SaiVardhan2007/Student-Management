'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { useAuth } from './auth-provider';

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Student Management System';
const SettingsContext = createContext<any>({ settings: { collegeName: APP_NAME }, reload: () => {} });

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<any>({ collegeName: APP_NAME });

  const reload = useCallback(async () => {
    try {
      const res = await api.get(user ? '/settings' : '/settings/public');
      setSettings((s: any) => ({ ...s, ...res.data.data }));
    } catch {
      /* branding is optional; keep defaults */
    }
  }, [user]);

  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    document.title = settings.collegeName || APP_NAME;
  }, [settings.collegeName]);

  const value = useMemo(() => ({ settings, reload }), [settings, reload]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);

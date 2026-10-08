'use client';

// Wraps the whole app (used in app/layout.tsx).

import { useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { ConfirmProvider } from './confirm-provider';

/** Providers needed on every page: toasts and the promise-based confirm dialog. */
export default function AppProviders({ children }: { children: React.ReactNode }) {
  // PWA: register the service worker (production only, so it never caches hot-reloading dev assets)
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
    }
  }, []);
  return (
    <ConfirmProvider>
      {children}
      <Toaster position="top-right" toastOptions={{ duration: 4000, style: { fontSize: 14 }, error: { duration: 6000 } }} />
    </ConfirmProvider>
  );
}

'use client';

import { Toaster } from 'react-hot-toast';
import { ConfirmProvider } from './confirm-provider';

/** Providers needed on every page: toasts and the promise-based confirm dialog. */
export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ConfirmProvider>
      {children}
      <Toaster position="top-right" toastOptions={{ duration: 4000, style: { fontSize: 14 }, error: { duration: 6000 } }} />
    </ConfirmProvider>
  );
}

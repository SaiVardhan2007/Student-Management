import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { AuthProvider } from '@/components/providers/auth-provider';
import { SettingsProvider } from '@/components/providers/settings-provider';

// Sign-in / sign-up pages are for signed-out visitors only.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session) redirect('/');
  return (
    <AuthProvider>
      <SettingsProvider>{children}</SettingsProvider>
    </AuthProvider>
  );
}

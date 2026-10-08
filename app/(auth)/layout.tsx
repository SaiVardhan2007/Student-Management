import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { AuthProvider } from '@/components/providers/auth-provider';
import { SettingsProvider } from '@/components/providers/settings-provider';

// Layout for login/register/password pages. Already signed-in users are sent to the dashboard.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session) redirect('/');
  return (
    <AuthProvider>
      <SettingsProvider>{children}</SettingsProvider>
    </AuthProvider>
  );
}

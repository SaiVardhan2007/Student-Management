import { getSession } from '@/lib/session';
import { AuthProvider } from '@/components/providers/auth-provider';
import { SettingsProvider } from '@/components/providers/settings-provider';
import AppShell from '@/components/layout/app-shell';

// Every page in this group needs a session. proxy.ts redirects anonymous visitors; this layout loads the user on the
// server so the first paint is already personalised, and AppShell enforces the per-role page rules.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <AuthProvider initialUser={session?.user ?? null} initialProfile={session?.profile ?? null}>
      <SettingsProvider>
        <AppShell>{children}</AppShell>
      </SettingsProvider>
    </AuthProvider>
  );
}

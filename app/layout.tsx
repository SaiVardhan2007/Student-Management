// Root layout: wraps every page with the HTML shell, global CSS and app-wide providers.
import type { Metadata, Viewport } from 'next';
import AppProviders from '@/components/providers/app-providers';
import './globals.css';

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Student Management System';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: 'Student Management System — attendance, marks, timetable, fees and more for your college.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/favicon.svg', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'SMS', statusBarStyle: 'default' },
};

export const viewport: Viewport = { themeColor: '#2563eb', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}

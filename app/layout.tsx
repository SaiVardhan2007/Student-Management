import type { Metadata, Viewport } from 'next';
import AppProviders from '@/components/providers/app-providers';
import './globals.css';

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Student Management System';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: 'Student Management System — attendance, marks, timetable, fees and more for your college.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/favicon.svg' },
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

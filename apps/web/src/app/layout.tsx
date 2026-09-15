import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/app-shell';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Sistema de Facturas · ERP Construcción',
  description: 'ERP de gestión integral para empresas de construcción',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ERP Obra',
  },
  icons: {
    icon: ['/icons/icon-192.png', '/icons/icon-512.png'],
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport = {
  themeColor: '#f59e0b',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}

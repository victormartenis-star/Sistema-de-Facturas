import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/app-shell';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Sistema de Facturas · ERP Construcción',
  description: 'ERP de gestión integral para empresas de construcción',
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

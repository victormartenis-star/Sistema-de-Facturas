import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
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
          <Sidebar />
          <div className="min-h-screen pl-16 lg:pl-56">
            <main className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}

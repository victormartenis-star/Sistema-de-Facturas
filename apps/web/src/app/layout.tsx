import type { Metadata } from 'next';
import './globals.css';
import { NavLinks } from '@/components/nav-links';
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
          <div className="min-h-screen">
            <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
              <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-sm font-bold text-white">
                  SF
                </span>
                <span className="text-sm font-semibold">
                  Sistema de Facturas
                </span>
                <NavLinks />
              </div>
            </header>
            <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}

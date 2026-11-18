'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Sidebar } from '@/components/sidebar';
import { Copiloto } from '@/components/copiloto';
import { OfflineSyncIndicator } from '@/components/offline-sync-indicator';
import { NotificationsBell } from '@/components/notifications-bell';
import { GlobalSearch } from '@/components/global-search';
import { useAuth } from '@/lib/auth';

const AUTH_PATHS = ['/login', '/registro'];

/** Shell de la app: sin sidebar en login/registro; gate de sesión en el resto. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { ready, user, soloLectura } = useAuth();
  const isAuthPage = AUTH_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (isAuthPage) {
    return <>{children}</>;
  }

  if (!ready || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8] text-sm text-gray-500">
        Cargando sesión…
      </div>
    );
  }

  return (
    <>
      <Sidebar />
      <div className="min-h-screen pl-16 lg:pl-56">
        {soloLectura && (
          <div className="bg-slate-100 px-4 py-1.5 text-center text-xs font-medium text-slate-700">
            Modo solo lectura: puedes consultar pero no modificar datos
          </div>
        )}
        {/* Cabecera en flujo: el buscador y la campana ya no flotan sobre el
            contenido, así que no tapan los botones de acción de las páginas. */}
        <header className="mx-auto flex max-w-6xl items-center justify-end gap-3 px-4 pt-4 lg:px-8">
          <GlobalSearch />
          <NotificationsBell />
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 lg:px-8">{children}</main>
      </div>
      <Copiloto />
      <OfflineSyncIndicator />
    </>
  );
}

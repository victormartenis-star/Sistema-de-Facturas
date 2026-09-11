'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Sidebar } from '@/components/sidebar';
import { useAuth } from '@/lib/auth';

const AUTH_PATHS = ['/login', '/registro'];

/** Shell de la app: sin sidebar en login/registro; gate de sesión en el resto. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { ready, user } = useAuth();
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
        <main className="mx-auto max-w-6xl px-4 py-8 lg:px-8">{children}</main>
      </div>
    </>
  );
}

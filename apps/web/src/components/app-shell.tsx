'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { loadSession, type StoredSession } from '@/lib/session';
import { Sidebar } from '@/components/sidebar';

/**
 * Envoltorio de la aplicación: sin sesión no se pinta nada y se manda a la
 * pantalla de acceso.
 *
 * Es una comodidad, no la seguridad del sistema: aunque alguien esquivara
 * esto, la API deniega por defecto y no devolvería ni un dato.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<StoredSession | null | undefined>(
    undefined,
  );

  useEffect(() => {
    setSession(loadSession());
  }, [pathname]);

  const isLoginPage = pathname === '/acceso';

  useEffect(() => {
    if (session === null && !isLoginPage) router.replace('/acceso');
  }, [session, isLoginPage, router]);

  // Primer render en el servidor: no se sabe todavía si hay sesión
  if (session === undefined) return null;

  if (isLoginPage) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8 lg:px-8">{children}</main>
    );
  }

  if (!session) return null;

  return (
    <>
      <Sidebar session={session} />
      <div className="min-h-screen pl-16 lg:pl-56">
        <main className="mx-auto max-w-6xl px-4 py-8 lg:px-8">{children}</main>
      </div>
    </>
  );
}

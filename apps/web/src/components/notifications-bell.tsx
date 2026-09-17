'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { alertsApi, formatDate } from '@/lib/api';
import { IconBell, IconCheck } from './icons';

const TYPE_LABELS: Record<string, string> = {
  compliance_doc: 'Homologación',
  permiso: 'Permisos',
  sobrecoste: 'Sobrecoste',
  garantia_postventa: 'Postventa',
};

/**
 * Campana de notificaciones (Fase 13): sondea el contador de no leídas cada
 * 60s (igual de discreto que el indicador offline) y despliega la bandeja
 * al pulsar. Las notificaciones las rellena `AlertsSchedulerService` en el
 * backend, no hay lógica de cálculo aquí — solo lectura y marcar-leída.
 */
export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const countQuery = useQuery({
    queryKey: ['alerts-unread-count'],
    queryFn: () => alertsApi.unreadCount(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const listQuery = useQuery({
    queryKey: ['alerts-notifications'],
    queryFn: () => alertsApi.listNotifications(),
    enabled: open,
  });

  const count = countQuery.data?.count ?? 0;

  const markRead = async (id: string) => {
    await alertsApi.markRead(id);
    queryClient.invalidateQueries({ queryKey: ['alerts-notifications'] });
    queryClient.invalidateQueries({ queryKey: ['alerts-unread-count'] });
  };

  const markAllRead = async () => {
    await alertsApi.markAllRead();
    queryClient.invalidateQueries({ queryKey: ['alerts-notifications'] });
    queryClient.invalidateQueries({ queryKey: ['alerts-unread-count'] });
  };

  return (
    <div className="fixed top-4 right-4 z-40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:bg-gray-50"
        title="Notificaciones"
      >
        <IconBell size={18} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-12 right-0 z-50 max-h-[70vh] w-96 overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <p className="text-sm font-semibold text-gray-900">
                Notificaciones
              </p>
              {(listQuery.data ?? []).some((n) => !n.read) && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-xs font-medium text-sky-600 hover:underline"
                >
                  <IconCheck size={12} />
                  Marcar todas leídas
                </button>
              )}
            </div>

            {listQuery.isLoading && (
              <p className="px-4 py-8 text-center text-sm text-gray-400">
                Cargando…
              </p>
            )}

            {!listQuery.isLoading && (listQuery.data ?? []).length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-gray-400">
                Sin notificaciones
              </p>
            )}

            <ul className="divide-y divide-gray-50">
              {(listQuery.data ?? []).map((n) => (
                <li
                  key={n.id}
                  className={`px-4 py-3 ${n.read ? '' : 'bg-amber-50/50'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="mb-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 uppercase">
                        {TYPE_LABELS[n.type] ?? n.type}
                      </span>
                      <p className="text-sm font-medium text-gray-900">
                        {n.title}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">{n.body}</p>
                      <p className="mt-1 text-[11px] text-gray-400">
                        {formatDate(n.createdAt.slice(0, 10))}
                      </p>
                    </div>
                    {!n.read && (
                      <button
                        onClick={() => markRead(n.id)}
                        title="Marcar como leída"
                        className="shrink-0 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-sky-600"
                      >
                        <IconCheck size={14} />
                      </button>
                    )}
                  </div>
                  {n.link && (
                    <Link
                      href={n.link}
                      onClick={() => setOpen(false)}
                      className="mt-1 inline-block text-xs text-sky-600 hover:underline"
                    >
                      Ver →
                    </Link>
                  )}
                </li>
              ))}
            </ul>

            <div className="border-t border-gray-100 px-4 py-2">
              <Link
                href="/configuracion/alertas"
                onClick={() => setOpen(false)}
                className="text-xs text-gray-500 hover:text-gray-800 hover:underline"
              >
                Configurar reglas de alerta →
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

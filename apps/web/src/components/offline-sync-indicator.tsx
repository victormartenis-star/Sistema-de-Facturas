'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { flushQueue, queueCount } from '@/lib/offline-queue';
import { useToast } from './toast';
import { IconAlertTriangle, IconLoader } from './icons';

/**
 * Registra el service worker (cascarón offline de la PWA, ver
 * `public/sw.js`) y muestra un indicador flotante con el número de items
 * pendientes de sincronizar en la cola de IndexedDB (`@/lib/offline-queue`)
 * — visible solo si hay algo en cola o si el navegador está sin conexión.
 * La sincronización se dispara sola al recuperar conexión (evento
 * `online`) y también a mano desde el botón del indicador.
 */
export function OfflineSyncIndicator() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const refreshCount = async () => {
    setPending(await queueCount());
  };

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const { ok, failed } = await flushQueue();
      if (ok > 0) {
        toast(
          `${ok} elemento${ok > 1 ? 's' : ''} sincronizado${ok > 1 ? 's' : ''}`,
          'success',
        );
        queryClient.invalidateQueries({ queryKey: ['fichajes'] });
        queryClient.invalidateQueries({ queryKey: ['checklists-prl'] });
      }
      if (failed > 0) {
        toast(`${failed} elemento(s) no se pudieron sincronizar`, 'error');
      }
    } finally {
      setSyncing(false);
      await refreshCount();
    }
  };

  useEffect(() => {
    setOnline(navigator.onLine);
    void refreshCount();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Entornos sin HTTPS/localhost (p.ej. detrás de un proxy sin TLS) no
        // dejan registrar el SW — la app sigue funcionando, solo sin
        // cascarón offline.
      });
    }

    const handleOnline = () => {
      setOnline(true);
      void sync();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const interval = setInterval(refreshCount, 15_000);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
    // `sync`/`refreshCount` se omiten a propósito: solo deben engancharse
    // los listeners una vez, al montar — no en cada re-render.
  }, []);

  if (online && pending === 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 lg:left-auto lg:right-4 lg:translate-x-0">
      <button
        onClick={sync}
        disabled={syncing || !online}
        className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium shadow-lg ${
          !online
            ? 'bg-gray-800 text-white'
            : 'bg-amber-500 text-white hover:bg-amber-600'
        }`}
      >
        {syncing ? (
          <IconLoader size={14} className="animate-spin" />
        ) : (
          <IconAlertTriangle size={14} />
        )}
        {!online
          ? `Sin conexión${pending > 0 ? ` · ${pending} pendiente${pending > 1 ? 's' : ''}` : ''}`
          : `${pending} pendiente${pending > 1 ? 's' : ''} · Sincronizar`}
      </button>
    </div>
  );
}

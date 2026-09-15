'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FICHAJE_TYPE_LABELS } from '@erp/shared';
import { formatDate, offlineFieldApi, projectsApi } from '@/lib/api';
import { submitOrQueue } from '@/lib/offline-queue';
import { useToast } from '@/components/toast';
import { IconCamera, IconClock, IconMapPin } from '@/components/icons';
import {
  ErrorBanner,
  PageHeader,
  TableSkeleton,
  selectCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

/**
 * Fichaje de entrada/salida, pensado para obra sin cobertura: si no hay
 * red, el fichaje se encola en IndexedDB (`submitOrQueue`) y se sincroniza
 * solo al volver la conexión — el botón nunca se queda esperando a la API.
 */
export default function FichajesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState('');
  const [workerName, setWorkerName] = useState('');
  const [submitting, setSubmitting] = useState<'entrada' | 'salida' | null>(
    null,
  );

  const projectsQuery = useQuery({
    queryKey: ['projects-for-fichajes'],
    queryFn: () => projectsApi.list('', ''),
  });
  const fichajesQuery = useQuery({
    queryKey: ['fichajes', projectId],
    queryFn: () => offlineFieldApi.listFichajes(projectId || undefined),
    enabled: !!projectId,
  });

  async function fichar(type: 'entrada' | 'salida') {
    if (!projectId || !workerName.trim()) {
      toast('Elige obra y escribe tu nombre', 'error');
      return;
    }
    setSubmitting(type);
    try {
      const position = await getPosition().catch(() => null);
      const { queued } = await submitOrQueue('fichaje', {
        projectId,
        workerName: workerName.trim(),
        type,
        occurredAt: new Date().toISOString(),
        latitude: position?.coords.latitude ?? null,
        longitude: position?.coords.longitude ?? null,
      });
      toast(
        queued
          ? `${FICHAJE_TYPE_LABELS[type]} guardada — se sincronizará sola con cobertura`
          : `${FICHAJE_TYPE_LABELS[type]} registrada`,
        'success',
      );
      queryClient.invalidateQueries({ queryKey: ['fichajes', projectId] });
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setSubmitting(null);
    }
  }

  async function subirFoto(file: File) {
    if (!projectId) {
      toast('Elige una obra primero', 'error');
      return;
    }
    try {
      const { queued } = await submitOrQueue('foto-avance', {
        file,
        projectId,
        // Sin tipo documental propio "foto de avance" todavía (exigiría
        // ampliar el enum `doc_type` en `packages/db/src/schema.ts`,
        // fuera de alcance aquí) — se archiva como "otro".
        docType: 'otro',
      });
      toast(
        queued ? 'Foto guardada — se subirá sola con cobertura' : 'Foto subida',
        'success',
      );
    } catch (e) {
      toast(errText(e), 'error');
    }
  }

  return (
    <div>
      <PageHeader
        title="Fichajes"
        subtitle="Entrada y salida por obra — funciona sin cobertura, se sincroniza sola"
      />

      <div className="mx-auto max-w-md space-y-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Obra
          </label>
          <select
            className={`${selectCls} mb-3`}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">Elige…</option>
            {projectsQuery.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>

          <label className="mb-1 block text-xs font-medium text-gray-600">
            Tu nombre
          </label>
          <input
            className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={workerName}
            onChange={(e) => setWorkerName(e.target.value)}
          />

          <div className="grid grid-cols-2 gap-3">
            <button
              className="flex flex-col items-center gap-1 rounded-xl bg-emerald-500 py-5 text-white shadow-sm hover:bg-emerald-600 disabled:opacity-50"
              disabled={submitting !== null}
              onClick={() => fichar('entrada')}
            >
              <IconClock size={24} />
              <span className="text-sm font-semibold">Entrada</span>
            </button>
            <button
              className="flex flex-col items-center gap-1 rounded-xl bg-gray-700 py-5 text-white shadow-sm hover:bg-gray-800 disabled:opacity-50"
              disabled={submitting !== null}
              onClick={() => fichar('salida')}
            >
              <IconClock size={24} />
              <span className="text-sm font-semibold">Salida</span>
            </button>
          </div>
          <p className="mt-3 flex items-center gap-1 text-xs text-gray-400">
            <IconMapPin size={12} /> Se guarda tu ubicación si el navegador la
            comparte.
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <label
            htmlFor="foto-avance-input"
            className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-300 py-6 text-gray-500 hover:border-amber-400 hover:text-amber-600"
          >
            <IconCamera size={24} />
            <span className="text-sm font-medium">Foto de avance</span>
          </label>
          <input
            id="foto-avance-input"
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void subirFoto(file);
            }}
          />
        </div>

        {projectId && (
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold">Fichajes de hoy</h2>
            {fichajesQuery.isLoading && <TableSkeleton rows={3} />}
            {fichajesQuery.error && (
              <ErrorBanner message={errText(fichajesQuery.error)} />
            )}
            <div className="divide-y divide-gray-100">
              {fichajesQuery.data?.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span>
                    {f.workerName} —{' '}
                    <span className="text-gray-500">
                      {FICHAJE_TYPE_LABELS[f.type]}
                    </span>
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatDate(f.occurredAt.slice(0, 10))}{' '}
                    {f.occurredAt.slice(11, 16)}
                  </span>
                </div>
              ))}
              {fichajesQuery.data?.length === 0 && (
                <p className="py-2 text-sm text-gray-400">
                  Sin fichajes todavía.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocalización no disponible'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      timeout: 3000,
      maximumAge: 60_000,
    });
  });
}

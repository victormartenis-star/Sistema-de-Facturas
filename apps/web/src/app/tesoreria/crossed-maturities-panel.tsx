'use client';

import { useQuery } from '@tanstack/react-query';
import { formatEur, treasuryApi } from '@/lib/api';
import { ErrorBanner } from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

/**
 * Cruce de vencimientos: cobros por certificación de obra frente al resto,
 * y pagos aplazados por confirming/pagaré frente al resto — la pregunta
 * real de tesorería en construcción es si lo que se espera certificar
 * llega a tiempo de cubrir lo ya comprometido en instrumentos aplazados.
 */
export function CrossedMaturitiesPanel() {
  const query = useQuery({
    queryKey: ['crossed-maturities'],
    queryFn: () => treasuryApi.crossedMaturities(),
  });
  const data = query.data;

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold">Cruce de vencimientos</h2>
      <p className="mb-4 text-xs text-gray-500">
        Cobros por certificación vs. resto · pagos por confirming/pagaré vs.
        resto{data ? ` (${data.from} – ${data.to})` : ''}
      </p>
      {query.error && <ErrorBanner message={errText(query.error)} />}
      {data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-medium text-emerald-700">
              Cobros por certificación
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-emerald-700">
              {formatEur(data.cobrosPorCertificacion.total)}
            </p>
            <p className="mt-1 text-xs text-emerald-600">
              {data.cobrosPorCertificacion.items.length} vencimiento(s)
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-medium text-gray-600">Otros cobros</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-gray-800">
              {formatEur(data.cobrosOtros.total)}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {data.cobrosOtros.items.length} vencimiento(s)
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-medium text-amber-700">
              Pagos por confirming/pagaré
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-amber-700">
              {formatEur(data.pagosConfirmingPagare.total)}
            </p>
            <p className="mt-1 text-xs text-amber-600">
              {data.pagosConfirmingPagare.items.length} vencimiento(s)
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-medium text-gray-600">Otros pagos</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-gray-800">
              {formatEur(data.pagosOtros.total)}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {data.pagosOtros.items.length} vencimiento(s)
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { formatEur, treasuryApi } from '@/lib/api';
import { ErrorBanner } from '@/components/ui';
import { IconAlertTriangle, IconCheck } from '@/components/icons';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

/** Proyección de iliquidez a 30/60/90 días a partir del saldo bancario actual. */
export function IlliquidityPanel() {
  const query = useQuery({
    queryKey: ['illiquidity-projection'],
    queryFn: () => treasuryApi.illiquidity(),
  });

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold">Proyección de iliquidez</h2>
      <p className="mb-4 text-xs text-gray-500">
        Saldo inicial (cuentas activas):{' '}
        {formatEur(query.data?.saldoInicial ?? null)}
      </p>
      {query.error && <ErrorBanner message={errText(query.error)} />}
      <div className="grid grid-cols-3 gap-3">
        {query.data?.horizontes.map((h) => (
          <div
            key={h.horizon}
            className={`rounded-xl border p-3 text-center ${
              h.tension
                ? 'border-red-200 bg-red-50'
                : 'border-gray-200 bg-gray-50'
            }`}
          >
            <p className="text-xs font-medium text-gray-500">
              {h.horizon} días
            </p>
            <p
              className={`mt-1 text-lg font-bold tabular-nums ${
                h.tension ? 'text-red-600' : 'text-gray-900'
              }`}
            >
              {formatEur(h.saldoFinal)}
            </p>
            <p className="mt-1 flex items-center justify-center gap-1 text-xs">
              {h.tension ? (
                <>
                  <IconAlertTriangle size={12} className="text-red-500" />
                  <span className="text-red-600">
                    Tensión
                    {h.primeraTensionEn ? ` desde ${h.primeraTensionEn}` : ''}
                  </span>
                </>
              ) : (
                <>
                  <IconCheck size={12} className="text-emerald-500" />
                  <span className="text-emerald-600">Sin tensión</span>
                </>
              )}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ApiError, comparativosApi, formatEur } from '@/lib/api';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  TableSkeleton,
} from '@/components/ui';
import { IconSparkles, IconTrendingUp } from '@/components/icons';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

export default function AhorroPage() {
  const query = useQuery({
    queryKey: ['comparativos-ahorro'],
    queryFn: comparativosApi.ahorro,
  });
  const [resumen, setResumen] = useState<string | null>(null);
  const [resumenError, setResumenError] = useState<string | null>(null);
  const [resumenLoading, setResumenLoading] = useState(false);

  const opportunities = query.data ?? [];
  const totalPotencial = opportunities.reduce(
    (s, o) => s + o.potentialSavingsAmount,
    0,
  );

  async function generarResumen() {
    setResumenLoading(true);
    setResumenError(null);
    setResumen(null);
    try {
      const res = await comparativosApi.resumenAhorro(opportunities);
      setResumen(res.resumen);
    } catch (err) {
      setResumenError(
        err instanceof ApiError
          ? err.message
          : 'No se ha podido generar el resumen.',
      );
    } finally {
      setResumenLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Recomendaciones de ahorro"
        subtitle="Partidas adjudicadas por encima del mínimo visto en otra obra o proveedor"
        count={opportunities.length}
      >
        <Link
          href="/comparativos"
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          ← Comparativos
        </Link>
      </PageHeader>

      {query.isError && <ErrorBanner message={errText(query.error)} />}
      {query.isLoading && <TableSkeleton />}

      {query.isSuccess && opportunities.length === 0 && (
        <EmptyState
          icon={<IconTrendingUp size={26} />}
          title="Sin oportunidades de ahorro detectadas"
        >
          <p className="mx-auto max-w-md text-sm text-gray-500">
            Se compara el precio unitario de las partidas adjudicadas frente al
            mínimo visto para el mismo código en cualquier otra obra o
            proveedor. Hacen falta al menos dos comparativos con ofertas del
            mismo código de partida para que aparezca algo aquí.
          </p>
        </EmptyState>
      )}

      {opportunities.length > 0 && (
        <>
          <div className="mt-2 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs text-gray-500">Ahorro potencial total</p>
            <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums text-emerald-700">
              {formatEur(totalPotencial)}
            </p>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={generarResumen}
              disabled={resumenLoading}
              className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-40"
            >
              <IconSparkles size={14} />
              {resumenLoading ? 'Redactando…' : 'Resumir con IA'}
            </button>
          </div>
          {resumenError && <ErrorBanner message={resumenError} />}
          {resumen && (
            <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/60 p-4 text-sm whitespace-pre-wrap text-gray-800">
              {resumen}
            </div>
          )}

          <div className="mt-6 overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                  <th className="px-4 py-3 font-medium">Partida</th>
                  <th className="px-4 py-3 font-medium">Obra (pagado)</th>
                  <th className="px-4 py-3 font-medium">Proveedor (pagado)</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Precio pagado
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    Mínimo visto
                  </th>
                  <th className="px-4 py-3 font-medium">Referencia</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Sobreprecio
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    Ahorro potencial
                  </th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((o, i) => (
                  <tr
                    key={`${o.budgetItemCode}-${o.paidProjectId}-${i}`}
                    className="border-b border-gray-100 last:border-0 hover:bg-amber-50/30"
                  >
                    <td className="px-4 py-3">
                      <span className="mr-1.5 text-xs text-gray-400">
                        {o.budgetItemCode}
                      </span>
                      {o.budgetItemName}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {o.paidProjectName}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {o.paidContactName}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-red-600">
                      {formatEur(o.paidUnitPrice)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                      {formatEur(o.minUnitPrice)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {o.minProjectName} · {o.minContactName}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-red-700">
                        +{o.overpayPct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-emerald-700">
                      {formatEur(o.potentialSavingsAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

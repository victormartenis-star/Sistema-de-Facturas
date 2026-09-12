'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { dashboardApi, formatEur, type ObrasKpiRow } from '@/lib/api';
import { ErrorBanner, PageHeader, TableSkeleton } from '@/components/ui';
import { IconBuilding, IconTrendingUp } from '@/components/icons';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  en_curso: 'En curso',
  finalizada: 'Finalizada',
  pendiente: 'Pendiente',
  cancelada: 'Cancelada',
};

const STATUS_COLORS: Record<string, string> = {
  en_curso: 'bg-emerald-100 text-emerald-700',
  finalizada: 'bg-sky-100 text-sky-700',
  pendiente: 'bg-amber-100 text-amber-700',
  cancelada: 'bg-gray-100 text-gray-500',
};

function fmt(n: number) {
  return formatEur(n);
}

function pct(n: number) {
  return `${n.toFixed(1)}%`;
}

function MargenBadge({ pct: p }: { pct: number }) {
  const cls =
    p >= 15
      ? 'bg-emerald-100 text-emerald-700'
      : p >= 5
        ? 'bg-amber-100 text-amber-700'
        : 'bg-red-100 text-red-700';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`}>
      {p.toFixed(1)}%
    </span>
  );
}

// ── Gráfico barras: contrato / certificado / coste por obra ──────────────────

function ObrasChart({ rows }: { rows: ObrasKpiRow[] }) {
  const data = rows
    .filter((r) => r.contractAmount > 0 || r.totalCertificado > 0)
    .map((r) => ({
      name: r.name.length > 16 ? r.name.slice(0, 14) + '…' : r.name,
      Contrato: r.contractAmount,
      Certificado: r.totalCertificado,
      'Coste real': r.costReal,
    }));

  if (data.length === 0) return null;

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold">
        Contrato · Certificado · Coste real por obra
      </h2>
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 60 + 60)}>
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
          <XAxis
            type="number"
            tickFormatter={(v: number) =>
              v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`
            }
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 10, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            width={120}
          />
          <Tooltip
            formatter={(v, name) => [fmt(Number(v ?? 0)), String(name)]}
            contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }}
          />
          <Legend
            iconType="square"
            iconSize={10}
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          />
          <Bar dataKey="Contrato" fill="#e0f2fe" maxBarSize={14} radius={[0, 3, 3, 0]} />
          <Bar dataKey="Certificado" fill="#6ee7b7" maxBarSize={14} radius={[0, 3, 3, 0]} />
          <Bar dataKey="Coste real" maxBarSize={14} radius={[0, 3, 3, 0]}>
            {rows
              .filter((r) => r.contractAmount > 0 || r.totalCertificado > 0)
              .map((r, i) => (
                <Cell
                  key={i}
                  fill={r.margenBruto < 0 ? '#fca5a5' : '#fbbf24'}
                />
              ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}

// ── Gráfico de márgenes ───────────────────────────────────────────────────────

function MargenesChart({ rows }: { rows: ObrasKpiRow[] }) {
  const data = rows
    .filter((r) => r.totalCertificado > 0)
    .map((r) => ({
      name: r.name.length > 16 ? r.name.slice(0, 14) + '…' : r.name,
      margenPct: r.margenPct,
      over: r.margenPct < 0,
    }));

  if (data.length === 0) return null;

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold">Margen bruto por obra (%)</h2>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 48 + 40)}>
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
          <XAxis
            type="number"
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 10, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            width={120}
          />
          <Tooltip
            formatter={(v) => [`${Number(v ?? 0).toFixed(1)}%`, 'Margen']}
            contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }}
          />
          <Bar dataKey="margenPct" maxBarSize={16} radius={[0, 3, 3, 0]}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={d.margenPct < 0 ? '#fca5a5' : d.margenPct < 5 ? '#fde68a' : '#6ee7b7'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-sm bg-emerald-300" />≥ 15%</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-sm bg-yellow-200" />5–15%</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-sm bg-red-300" />{'< 5%'}</span>
      </div>
    </section>
  );
}

// ── Tabla resumen ────────────────────────────────────────────────────────────

function ObrasTable({ rows }: { rows: ObrasKpiRow[] }) {
  if (rows.length === 0) return null;

  const totContrato = rows.reduce((s, r) => s + r.contractAmount, 0);
  const totCert = rows.reduce((s, r) => s + r.totalCertificado, 0);
  const totCost = rows.reduce((s, r) => s + r.costReal, 0);
  const totMargen = totCert - totCost;
  const totMargenPct = totCert > 0 ? (totMargen / totCert) * 100 : 0;

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Obra</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Estado</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Contrato</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Certificado</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">% cert.</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Coste real</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Margen</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">% margen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.projectId} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/obras/${r.projectId}`}
                    className="font-medium text-gray-900 hover:text-amber-600"
                  >
                    <span className="mr-2 text-xs text-gray-400">{r.code}</span>
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[r.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmt(r.contractAmount)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-700 font-medium">{fmt(r.totalCertificado)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">{pct(r.pctCertificado)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmt(r.costReal)}</td>
                <td className={`px-4 py-3 text-right tabular-nums font-medium ${r.margenBruto < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {fmt(r.margenBruto)}
                </td>
                <td className="px-4 py-3 text-right">
                  <MargenBadge pct={r.margenPct} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50">
            <tr>
              <td className="px-4 py-3 font-semibold text-gray-700" colSpan={2}>Total</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmt(totContrato)}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">{fmt(totCert)}</td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmt(totCost)}</td>
              <td className={`px-4 py-3 text-right font-semibold tabular-nums ${totMargen < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {fmt(totMargen)}
              </td>
              <td className="px-4 py-3 text-right">
                <MargenBadge pct={totMargenPct} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function InformesPage() {
  const query = useQuery({
    queryKey: ['dashboard-obras'],
    queryFn: dashboardApi.obrasKpi,
    staleTime: 2 * 60 * 1000,
  });

  const rows = query.data ?? [];

  // KPIs resumen
  const enCurso = rows.filter((r) => r.status === 'en_curso');
  const totContrato = enCurso.reduce((s, r) => s + r.contractAmount, 0);
  const totCert = enCurso.reduce((s, r) => s + r.totalCertificado, 0);
  const totMargen = enCurso.reduce((s, r) => s + r.margenBruto, 0);
  const margenGlobal = totCert > 0 ? (totMargen / totCert) * 100 : 0;

  return (
    <div className="animate-fade-in-up">
      <PageHeader
        title="Informes"
        subtitle="Rentabilidad y avance económico por obra"
        count={rows.length}
      />

      {query.isError && (
        <ErrorBanner message={(query.error as Error).message} />
      )}

      {/* KPIs resumen (solo obras en curso) */}
      {!query.isLoading && enCurso.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Obras en curso', value: String(enCurso.length), icon: <IconBuilding size={18} />, color: 'text-sky-600 bg-sky-50' },
            { label: 'Contratado', value: fmt(totContrato), icon: <IconTrendingUp size={18} />, color: 'text-gray-700 bg-gray-100' },
            { label: 'Certificado', value: fmt(totCert), icon: <IconTrendingUp size={18} />, color: 'text-emerald-600 bg-emerald-50' },
            {
              label: 'Margen global',
              value: `${margenGlobal.toFixed(1)}%`,
              icon: <IconTrendingUp size={18} />,
              color: margenGlobal < 5 ? 'text-red-600 bg-red-50' : margenGlobal < 15 ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50',
            },
          ].map(({ label, value, icon, color }) => (
            <div key={label} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${color}`}>
                  {icon}
                </span>
                <p className="text-sm font-medium text-gray-500">{label}</p>
              </div>
              <p className="mt-3 text-xl font-bold tracking-tight tabular-nums text-gray-900">
                {value}
              </p>
            </div>
          ))}
        </div>
      )}

      {query.isLoading && <TableSkeleton rows={5} />}

      {!query.isLoading && rows.length === 0 && !query.isError && (
        <p className="mt-8 text-center text-sm text-gray-500">
          Sin obras con datos económicos.{' '}
          <Link href="/obras" className="text-amber-600 underline">
            Crea una obra
          </Link>{' '}
          para ver informes.
        </p>
      )}

      <ObrasTable rows={rows} />
      <ObrasChart rows={rows} />
      <MargenesChart rows={rows} />
    </div>
  );
}

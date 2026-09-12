'use client';

/**
 * Página /homologacion/alertas
 *
 * Muestra todos los contactos con documentación bloqueante próxima a vencer
 * (≤ 30 días) o ya vencida. Permite ajustar el horizonte de alerta.
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ComplianceAlertDto, ComplianceAlertItem } from '@erp/shared';
import { complianceApi, formatDate } from '@/lib/api';
import { IconBell, IconShield } from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  TableSkeleton,
  selectCls,
  fieldCls,
  labelCls,
  btnGhostCls,
} from '@/components/ui';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function urgencyStyle(days: number): string {
  if (days < 0) return 'bg-red-100 text-red-700 border-red-200';
  if (days <= 7) return 'bg-orange-100 text-orange-700 border-orange-200';
  if (days <= 15) return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-yellow-50 text-yellow-700 border-yellow-200';
}

function daysLabel(days: number): string {
  if (days < 0) return `Venció hace ${Math.abs(days)} días`;
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  return `Vence en ${days} días`;
}

function DocAlertPill({ item }: { item: ComplianceAlertItem }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${urgencyStyle(item.daysToExpiry)}`}
    >
      <span>{item.docTypeLabel}</span>
      <span className="opacity-70">·</span>
      <span>{daysLabel(item.daysToExpiry)}</span>
      {item.expiresAt && (
        <span className="opacity-60">({formatDate(item.expiresAt)})</span>
      )}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  bloqueado: 'bg-red-100 text-red-700',
  bloqueado_manual: 'bg-red-100 text-red-700',
  con_avisos: 'bg-amber-100 text-amber-700',
  homologado: 'bg-emerald-100 text-emerald-700',
  exento: 'bg-sky-100 text-sky-700',
  no_aplica: 'bg-gray-100 text-gray-500',
};
const STATUS_LABELS: Record<string, string> = {
  bloqueado: 'Bloqueado',
  bloqueado_manual: 'Bloqueado',
  con_avisos: 'Con avisos',
  homologado: 'Homologado',
  exento: 'Exento',
  no_aplica: 'No aplica',
};

const HORIZONTE_OPTIONS = [
  { value: 7, label: '7 días' },
  { value: 15, label: '15 días' },
  { value: 30, label: '30 días (recomendado)' },
  { value: 60, label: '60 días' },
  { value: 90, label: '90 días' },
];

// ─── Página ───────────────────────────────────────────────────────────────────

export default function AlertasCompliancePage() {
  const [days, setDays] = useState(30);

  const query = useQuery({
    queryKey: ['compliance-alertas', days],
    queryFn: () => complianceApi.alertas(days),
    staleTime: 2 * 60_000,
  });

  const alertas: ComplianceAlertDto[] = query.data ?? [];
  const vencidos = alertas.filter((a) => a.alerts.some((x) => x.expired));
  const proximos = alertas.filter((a) => !a.alerts.some((x) => x.expired));

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Alertas de homologación"
        subtitle="Documentos bloqueantes próximos a vencer o ya vencidos"
      >
        <Link href="/homologacion" className={btnGhostCls}>
          ← Panel de homologación
        </Link>
      </PageHeader>

      {/* Horizonte */}
      <div className={fieldCls + ' max-w-xs'}>
        <label className={labelCls}>Horizonte de alerta</label>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className={selectCls}
        >
          {HORIZONTE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {query.isLoading && <TableSkeleton rows={5} />}
      {query.error && <ErrorBanner message={(query.error as Error).message} />}

      {!query.isLoading && !query.error && alertas.length === 0 && (
        <EmptyState icon={<IconShield size={40} />} title="Sin alertas">
          <p className="text-sm text-gray-500">
            Ningún contacto tiene documentación bloqueante que caduque en los próximos {days} días.
          </p>
        </EmptyState>
      )}

      {/* Vencidos */}
      {vencidos.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-600">
            <IconBell size={16} />
            Documentación vencida ({vencidos.length} contacto{vencidos.length !== 1 ? 's' : ''})
          </h2>
          <AlertTable rows={vencidos} />
        </section>
      )}

      {/* Próximos a vencer */}
      {proximos.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-600">
            <IconBell size={16} />
            Próximos a vencer en {days} días ({proximos.length} contacto{proximos.length !== 1 ? 's' : ''})
          </h2>
          <AlertTable rows={proximos} />
        </section>
      )}
    </div>
  );
}

function AlertTable({ rows }: { rows: ComplianceAlertDto[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-500">
            <th className="px-4 py-3">Proveedor / Subcontrata</th>
            <th className="px-4 py-3">CIF</th>
            <th className="px-4 py-3">Estado</th>
            <th className="px-4 py-3">Documentos afectados</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.contactId} className="border-b border-gray-50 hover:bg-gray-50/40">
              <td className="px-4 py-3 font-medium text-gray-900">{a.legalName}</td>
              <td className="px-4 py-3 font-mono text-xs text-gray-500">
                {a.taxId ?? '—'}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[a.status] ?? 'bg-gray-100 text-gray-600'}`}
                >
                  {STATUS_LABELS[a.status] ?? a.status}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1.5">
                  {a.alerts.map((item) => (
                    <DocAlertPill key={item.docType} item={item} />
                  ))}
                </div>
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/contactos/${a.contactId}`}
                  className="text-xs text-sky-600 hover:underline"
                >
                  Ver ficha →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

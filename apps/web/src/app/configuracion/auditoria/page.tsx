'use client';

/**
 * Página /configuracion/auditoria
 *
 * Historial de auditoría: quién hizo qué y cuándo sobre cada entidad del ERP.
 * Solo accesible para roles admin y gerente.
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, type AuditAction, type AuditEntityType, type AuditLogDto } from '@erp/shared';
import { auditApi, formatDate } from '@/lib/api';
import { IconShield } from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  TableSkeleton,
  selectCls,
  fieldCls,
  labelCls,
} from '@/components/ui';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_STYLES: Record<AuditAction, string> = {
  create: 'bg-emerald-100 text-emerald-700',
  update: 'bg-sky-100 text-sky-700',
  delete: 'bg-red-100 text-red-600',
};

const ACTION_LABELS: Record<AuditAction, string> = {
  create: 'Crear',
  update: 'Actualizar',
  delete: 'Eliminar',
};

const ENTITY_LABELS: Record<string, string> = {
  project: 'Obra',
  budget: 'Presupuesto',
  certification: 'Certificación',
  certification_line: 'Línea cert.',
  invoice: 'Factura',
  purchase_order: 'Pedido',
  delivery_note: 'Albarán',
  contact: 'Contacto',
  document: 'Documento',
  payment_milestone: 'Vencimiento',
  user: 'Usuario',
};

function ActionBadge({ action }: { action: string }) {
  const style = ACTION_STYLES[action as AuditAction] ?? 'bg-gray-100 text-gray-600';
  const label = ACTION_LABELS[action as AuditAction] ?? action;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}

function DataPreview({ data }: { data: unknown }) {
  if (!data) return <span className="text-gray-300">—</span>;
  const str = JSON.stringify(data);
  const short = str.length > 80 ? str.slice(0, 80) + '…' : str;
  return (
    <code className="break-all rounded bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-600">
      {short}
    </code>
  );
}

function formatOccurredAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ─── Página ───────────────────────────────────────────────────────────────────

const ENTITY_TYPE_OPTIONS = [{ value: '', label: 'Todas las entidades' }, ...AUDIT_ENTITY_TYPES.map(t => ({ value: t, label: ENTITY_LABELS[t] ?? t }))];
const ACTION_OPTIONS = [{ value: '', label: 'Todas las acciones' }, ...AUDIT_ACTIONS.map(a => ({ value: a, label: ACTION_LABELS[a] }))];
const LIMIT_OPTIONS = [25, 50, 100, 200];

export default function AuditoriaPage() {
  const [entityType, setEntityType] = useState<AuditEntityType | ''>('');
  const [action, setAction] = useState<AuditAction | ''>('');
  const [limit, setLimit] = useState(50);

  const query = useQuery({
    queryKey: ['audit', entityType, action, limit],
    queryFn: () =>
      auditApi.list({
        ...(entityType ? { entityType } : {}),
        ...(action ? { action } : {}),
        limit,
        offset: 0,
      }),
    staleTime: 30_000,
  });

  const entries: AuditLogDto[] = query.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Auditoría"
        subtitle="Registro de todas las mutaciones del ERP con marca de tiempo y usuario"
      />

      {/* Filtros */}
      <div className="flex flex-wrap gap-4">
        <div className={fieldCls + ' min-w-[200px]'}>
          <label className={labelCls}>Entidad</label>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as AuditEntityType | '')}
            className={selectCls}
          >
            {ENTITY_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className={fieldCls + ' min-w-[170px]'}>
          <label className={labelCls}>Acción</label>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as AuditAction | '')}
            className={selectCls}
          >
            {ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className={fieldCls + ' min-w-[130px]'}>
          <label className={labelCls}>Límite</label>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className={selectCls}
          >
            {LIMIT_OPTIONS.map((l) => (
              <option key={l} value={l}>{l} registros</option>
            ))}
          </select>
        </div>
      </div>

      {query.isLoading && <TableSkeleton rows={8} />}
      {query.error && <ErrorBanner message={(query.error as Error).message} />}

      {!query.isLoading && !query.error && entries.length === 0 && (
        <EmptyState icon={<IconShield size={40} />} title="Sin registros de auditoría">
          <p className="text-sm text-gray-500">
            Las acciones de creación, modificación y borrado quedarán registradas aquí.
          </p>
        </EmptyState>
      )}

      {entries.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Fecha y hora</th>
                <th className="px-4 py-3">Acción</th>
                <th className="px-4 py-3">Entidad</th>
                <th className="px-4 py-3">ID entidad</th>
                <th className="px-4 py-3">Usuario</th>
                <th className="px-4 py-3">Datos nuevos</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50/40">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500 whitespace-nowrap">
                    {formatOccurredAt(e.occurredAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <ActionBadge action={e.action} />
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">
                    <div className="font-medium">{ENTITY_LABELS[e.entityType] ?? e.entityType}</div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-400">
                    {e.entityId.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-400">
                    {e.userId ? e.userId.slice(0, 8) + '…' : <span className="text-gray-300">sistema</span>}
                  </td>
                  <td className="px-4 py-2.5 max-w-xs">
                    <DataPreview data={e.newData ?? e.oldData} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-gray-100 px-4 py-2 text-right text-xs text-gray-400">
            {entries.length} registros mostrados
          </div>
        </div>
      )}
    </div>
  );
}

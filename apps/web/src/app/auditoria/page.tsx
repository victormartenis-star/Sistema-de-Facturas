'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  AUDIT_ENTITY_LABELS,
  USER_ROLE_LABELS,
  auditActionLabel,
  auditEntityLabel,
  type UserRole,
} from '@erp/shared';
import { auditApi } from '@/lib/api';
import { IconLock } from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  TableSkeleton,
  fieldCls,
  selectCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

/** Fecha y hora legibles, en la zona del navegador. */
function stamp(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AuditoriaPage() {
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const query = useQuery({
    queryKey: ['auditoria', entity, from, to],
    queryFn: () => auditApi.list({ entity, from, to, limit: 200 }),
  });

  const rows = query.data ?? [];

  return (
    <div>
      <PageHeader
        title="Registro de auditoría"
        subtitle="Quién hizo qué y cuándo. Solo lectura: el registro no se puede alterar"
        count={rows.length}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <select
          className={selectCls}
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
        >
          <option value="">Todos los módulos</option>
          {Object.entries(AUDIT_ENTITY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="date"
          className={fieldCls}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          title="Desde"
        />
        <input
          type="date"
          className={fieldCls}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          title="Hasta"
        />
      </div>

      {query.isError && <ErrorBanner message={errText(query.error)} />}
      {query.isLoading && <TableSkeleton rows={8} />}

      {query.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<IconLock size={26} />}
          title="No hay movimientos con ese filtro"
        />
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                <th className="px-4 py-3 font-medium">Cuándo</th>
                <th className="px-4 py-3 font-medium">Quién</th>
                <th className="px-4 py-3 font-medium">Qué hizo</th>
                <th className="px-4 py-3 font-medium">Módulo</th>
                <th className="px-4 py-3 font-medium">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`border-b border-gray-100 last:border-0 ${
                    r.statusCode >= 400 ? 'bg-red-50/50' : ''
                  }`}
                >
                  <td className="px-4 py-3 text-xs whitespace-nowrap text-gray-600">
                    {stamp(r.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    {r.userName ?? (
                      <span className="text-gray-400">Sin identificar</span>
                    )}
                    {r.userRole && (
                      <span className="block text-[11px] text-gray-500">
                        {USER_ROLE_LABELS[r.userRole as UserRole] ?? r.userRole}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {auditActionLabel(r.action)}
                    {r.statusCode >= 400 && (
                      <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                        RECHAZADO
                      </span>
                    )}
                    <span className="block font-mono text-[11px] text-gray-400">
                      {r.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {auditEntityLabel(r.entity)}
                  </td>
                  <td className="max-w-md px-4 py-3">
                    {r.payload && Object.keys(r.payload).length > 0 && (
                      <code className="block truncate text-[11px] text-gray-500">
                        {JSON.stringify(r.payload)}
                      </code>
                    )}
                    {r.ip && (
                      <span className="text-[11px] text-gray-400">{r.ip}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-500">
        El registro es de solo inserción: la base de datos rechaza cualquier
        intento de modificarlo o borrarlo. Las contraseñas y los tokens se
        ocultan antes de guardar nada.
      </p>
    </div>
  );
}

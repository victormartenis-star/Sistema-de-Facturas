'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { btnGhostCls, selectCls } from '@/components/ui';
import {
  IconPlus,
  IconChevronDown,
  IconAlertTriangle,
} from '@/components/icons';
import { ProveedorTableRow } from '@/types/erp-finance';

/**
 * Componente Tabla de Proveedores
 *
 * Muestra una lista de proveedores/subcontratas con badges de estado
 * (Apto para Pago / Documentación Caducada) y acciones rápidas.
 */

interface ProveedoresTableProps {
  projectId?: string;
  onVerDetalle?: (proveedor: ProveedorTableRow) => void;
  onVerPRL?: (proveedorId: string) => void;
  onCreate?: () => void;
}

interface ColumnDef<T> {
  accessorKey: string;
  header: string;
  cell: (args: { row: { original: T } }) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
}

function getColumns(
  onVerPRL: ((proveedorId: string) => void) | undefined,
): ColumnDef<ProveedorTableRow>[] {
  return [
    {
      accessorKey: 'cifNif',
      header: 'Razón Social / CIF',
      cell: ({ row }) => (
        <div className="font-medium text-gray-800">
          {row.original.cifNif} - {row.original.razonSocial || 'Sin nombre'}
        </div>
      ),
      align: 'left',
    },
    {
      accessorKey: 'tipo',
      header: 'Tipo',
      cell: ({ row }) => (
        <span
          className={
            row.original.tipo === 'subcontrata'
              ? 'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-amber-600 bg-amber-100'
              : 'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-blue-500 bg-blue-100'
          }
        >
          {row.original.tipo}
        </span>
      ),
      align: 'center',
    },
    {
      accessorKey: 'categoriaPrincipal',
      header: 'Categoría',
      cell: ({ row }) => (
        <span className="text-sm text-gray-500">
          {row.original.categoriaPrincipal || '—'}
        </span>
      ),
      align: 'left',
    },
    {
      accessorKey: 'retencionGarantiaPct',
      header: 'Retención %',
      cell: ({ row }) => (
        <span>{row.original.retencionGarantiaPct.toFixed(1)} %</span>
      ),
      align: 'right',
    },
    {
      accessorKey: 'estadoPago',
      header: 'Estado Pago',
      cell: ({ row }) => {
        // La validación real (documentación PRL) la resuelve el backend en
        // GET /proveedores/:id/validar-pago; aquí solo se refleja el flag activo.
        const apto = row.original.activo;
        return (
          <span
            className={
              apto ? 'font-medium text-green-600' : 'font-medium text-red-600'
            }
          >
            {apto ? 'Activo' : 'Inactivo'}
          </span>
        );
      },
      align: 'center',
    },
    {
      accessorKey: 'acciones',
      header: 'Acciones',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => onVerPRL?.(row.original.id)}
            className={btnGhostCls + ' gap-1 text-xs text-amber-500'}
            title="Ver PRL"
          >
            <IconChevronDown size={12} />
          </button>
        </div>
      ),
      align: 'right',
    },
  ];
}

function ProveedoresTable({
  projectId,
  onVerPRL,
  onCreate,
}: ProveedoresTableProps) {
  const [, setExpandedId] = useState<string | null>(null);

  const proveedoresQuery = useQuery({
    queryKey: ['proveedores', projectId],
    queryFn: async () => {
      // En producción: llamar a la API /proveedores?projectId=...
      // Por ahora devolvemos datos vacíos para que el componente esté listo
      return [] as ProveedorTableRow[];
    },
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  });

  const proveedores: ProveedorTableRow[] = proveedoresQuery.data ?? [];
  const isLoading = proveedoresQuery.isLoading;
  const columns = getColumns(onVerPRL);

  const totalProveedores = proveedores.length;
  const activos = proveedores.filter((p) => p.activo).length;

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100">
        <h2 className="text-xl font-bold text-gray-900">
          Proveedores y Subcontratas{' '}
          {totalProveedores > 0 && (
            <span className="text-amber-500">{totalProveedores}</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onCreate?.()}
            className={btnGhostCls + ' gap-1 text-sm'}
            title="Nuevo proveedor"
          >
            <IconPlus size={12} /> Nuevo
          </button>
          <select className={selectCls} defaultValue="">
            <option value="">Ver todos</option>
            <option value="activos">Activos ({activos})</option>
            <option value="inactivos">
              Inactivos ({totalProveedores - activos})
            </option>
          </select>
        </div>
      </div>

      {isLoading && !proveedores.length && (
        <div className="p-8 animate-fade-in-up">Cargando…</div>
      )}

      {!isLoading && proveedores.length === 0 && (
        <div className="p-8 text-center text-gray-500">
          <IconAlertTriangle size={48} className="mx-auto mb-4 opacity-50" />
          <p>No hay proveedores registrados</p>
          <p className="mt-2 text-sm">
            Haz clic en &quot;Nuevo proveedor&quot; para dar de alta un nuevo
            subcontratista
          </p>
        </div>
      )}

      {!isLoading && proveedores.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-500">
                {columns.map((col) => (
                  <th key={col.accessorKey} className="px-4 py-3">
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {proveedores.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-gray-50 hover:bg-gray-50/50"
                  onClick={() => setExpandedId(row.id)}
                >
                  {columns.map((col) => (
                    <td key={col.accessorKey} className="px-4 py-3">
                      <div
                        className={
                          col.align === 'right'
                            ? 'text-right'
                            : col.align === 'center'
                              ? 'text-center'
                              : ''
                        }
                      >
                        {col.cell({ row: { original: row } })}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export { ProveedoresTable, type ProveedoresTableProps };

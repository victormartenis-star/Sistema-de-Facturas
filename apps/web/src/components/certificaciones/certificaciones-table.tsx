'use client';

import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { formatEur, formatDate } from '@/lib/api';
import { EmptyState, TableSkeleton, btnGhostCls } from '@/components/ui';
import {
  IconChevronDown,
  IconTrash,
  IconReceipt,
  IconClipboard,
} from '@/components/icons';
import { CertTableRow } from '@/types/erp-finance';

/**
 * Componente Tabla de Certificaciones
 *
 * Muestra un Data Grid con las certificaciones de una obra,
 * incluyendo columnas de estado, presupuesto, monto ejecutado y retención.
 *
 * Props:
 *   - projectId: UUID de la obra opcional; si no se provee, muestra todas las accesibles
 *   - onFacturar: callback opcional al hacer click en "Facturar" (estado borrador)
 *   - onDelete: callback opcional al hacer click en "Eliminar" (estado borrador)
 *   - onVerLinas: callback opcional al hacer click en "Ver líneas"
 */

interface CertificadosTableProps {
  projectId?: string;
  onFacturar?: (cert: CertTableRow) => void;
  onDelete?: (cert: CertTableRow) => void;
  onVerLinas?: (certId: string) => void;
}

function pct(n: number): string {
  return `${n.toFixed(2)} %`;
}

interface ColumnDef<T> {
  accessorKey: string;
  header: string;
  cell: (args: { row: { original: T } }) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
}

function getColumns(
  onFacturar: ((cert: CertTableRow) => void) | undefined,
  onDelete: ((cert: CertTableRow) => void) | undefined,
  onVerLinas: ((certId: string) => void) | undefined,
): ColumnDef<CertTableRow>[] {
  return [
    {
      accessorKey: 'seq',
      header: 'Nº',
      cell: ({ row }) => row.original.seq,
      align: 'center',
    },
    {
      accessorKey: 'certDate',
      header: 'Fecha',
      cell: ({ row }) => formatDate(row.original.certDate),
      align: 'center',
    },
    {
      accessorKey: 'cumulativePct',
      header: '% Ejecutado',
      cell: ({ row }) => pct(row.original.cumulativePct),
      align: 'center',
    },
    {
      accessorKey: 'periodAmount',
      header: 'Monto Ejecutado',
      cell: ({ row }) => formatEur(row.original.periodAmount),
      align: 'right',
    },
    {
      accessorKey: 'retentionAmount',
      header: 'Retención',
      cell: ({ row }) => formatEur(row.original.retentionAmount),
      align: 'right',
    },
    {
      accessorKey: 'status',
      header: 'Estado',
      cell: ({ row }) => {
        const statusStyles: Record<string, string> = {
          borrador: 'bg-gray-200 text-gray-600',
          facturada: 'bg-emerald-100 text-emerald-700',
        };
        return (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[row.original.status]}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
            {row.original.status}
          </span>
        );
      },
      align: 'center',
    },
    {
      accessorKey: 'actions',
      header: 'Acciones',
      cell: ({ row }) => {
        const cert = row.original;
        const isBorrador = cert.status === 'borrador';
        return (
          <div className="flex items-center gap-2">
            {isBorrador && (
              <button
                onClick={() => onFacturar?.(cert)}
                className={btnGhostCls + ' gap-1.5 text-xs'}
                title="Facturar"
              >
                <IconReceipt size={12} />
                Facturar
              </button>
            )}
            {isBorrador && (
              <button
                onClick={() => onDelete?.(cert)}
                className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                title="Eliminar"
              >
                <IconTrash size={12} />
              </button>
            )}
            <button
              onClick={() => onVerLinas?.(cert.id)}
              className={btnGhostCls + ' gap-1.5 text-xs'}
              title="Ver líneas"
            >
              <IconChevronDown size={12} />
            </button>
          </div>
        );
      },
      align: 'center',
    },
  ];
}

function CertificadosTable({
  projectId,
  onFacturar,
  onDelete,
  onVerLinas,
}: CertificadosTableProps) {
  const certsQuery = useQuery({
    queryKey: ['certifications', projectId],
    queryFn: () => {
      // Llamada a la API - en producción usarías certificationsApi.list(projectId)
      // Por ahora simulamos con un placeholder que el hook manejará
      return Promise.resolve([] as CertTableRow[]);
    },
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  });

  const certs: CertTableRow[] = certsQuery.data ?? [];
  const isLoading = certsQuery.isLoading;

  const totalCertificado = certs.reduce((s, c) => s + c.periodAmount, 0);
  const totalRetencion = certs.reduce((s, c) => s + c.retentionAmount, 0);
  const columns = getColumns(onFacturar, onDelete, onVerLinas);

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      {certs.length > 0 && (
        <div className="flex gap-6 border-b border-gray-100 px-6 py-4 text-sm">
          <div>
            <span className="text-gray-500">Total certificado: </span>
            <span className="font-semibold text-gray-800">
              {formatEur(totalCertificado)}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Retención acumulada: </span>
            <span className="font-semibold text-gray-800">
              {formatEur(totalRetencion)}
            </span>
          </div>
        </div>
      )}
      <Table
        data={certs}
        columns={columns}
        loading={isLoading}
        emptyState={
          <EmptyState
            icon={<IconClipboard size={40} />}
            title="Sin certificaciones"
          >
            <p className="text-sm text-gray-500">
              Crea la primera certificación para registrar el avance de la obra
            </p>
          </EmptyState>
        }
      />
    </div>
  );
}

interface TableProps<T extends { id: string }> {
  data: T[];
  columns: ColumnDef<T>[];
  loading?: boolean;
  emptyState?: React.ReactNode;
}

/**
 * Componente Table base que maneja el esqueleto de carga y el estado vacío.
 */
function Table<T extends { id: string }>({
  data,
  columns,
  loading,
  emptyState,
}: TableProps<T>) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading && !data.length) {
    return <TableSkeleton rows={6} />;
  }

  if (data.length === 0 && !loading) {
    return emptyState ?? null;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
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
          {data.map((row) => (
            <Fragment key={row.id}>
              <tr
                key={row.id}
                className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer"
                onClick={() =>
                  setExpandedId(expandedId === row.id ? null : row.id)
                }
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
              {expandedId === row.id && (
                <tr key={`${row.id}-lines`}>
                  <td colSpan={columns.length} className="p-0">
                    <p className="text-xs text-gray-400 py-2 px-4">
                      Haz clic en &quot;Ver líneas&quot; para ver el desglose
                      por partida
                    </p>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { CertificadosTable, type CertificadosTableProps };

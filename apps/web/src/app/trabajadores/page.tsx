'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  TRABAJADOR_TIPO_LABELS,
  TRABAJADOR_TIPOS,
  type TrabajadorTipo,
} from '@erp/shared';
import { trabajadoresApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconTrash, IconUsers } from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  TableSkeleton,
  btnPrimaryCls,
  fieldCls,
  selectCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

/** Alta rápida de un trabajador del maestro (propio o subcontratado). */
function TrabajadorQuickForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const [nombre, setNombre] = useState('');
  const [documentoIdentidad, setDocumentoIdentidad] = useState('');
  const [tipo, setTipo] = useState<TrabajadorTipo>('propio');
  const [ordinaryRateDefault, setOrdinaryRateDefault] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      trabajadoresApi.create({
        nombre,
        documentoIdentidad: documentoIdentidad.trim() || null,
        tipo,
        ordinaryRateDefault: ordinaryRateDefault.trim()
          ? Number(ordinaryRateDefault.replace(',', '.'))
          : null,
      }),
    onSuccess: () => {
      toast('Trabajador dado de alta');
      setNombre('');
      setDocumentoIdentidad('');
      setOrdinaryRateDefault('');
      qc.invalidateQueries({ queryKey: ['trabajadores'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!nombre.trim()) return;
        mutation.mutate();
      }}
      className="grid grid-cols-2 gap-3 sm:grid-cols-5"
    >
      <input
        className={`${fieldCls} col-span-2`}
        placeholder="Nombre del trabajador"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        required
      />
      <input
        className={fieldCls}
        placeholder="DNI / NIE"
        value={documentoIdentidad}
        onChange={(e) => setDocumentoIdentidad(e.target.value)}
      />
      <select
        className={selectCls}
        value={tipo}
        onChange={(e) => setTipo(e.target.value as TrabajadorTipo)}
      >
        {TRABAJADOR_TIPOS.map((t) => (
          <option key={t} value={t}>
            {TRABAJADOR_TIPO_LABELS[t]}
          </option>
        ))}
      </select>
      <input
        className={fieldCls}
        inputMode="decimal"
        placeholder="Tarifa €/hora"
        value={ordinaryRateDefault}
        onChange={(e) => setOrdinaryRateDefault(e.target.value)}
      />
      <button
        type="submit"
        disabled={mutation.isPending}
        className={`${btnPrimaryCls} col-span-2 justify-center sm:col-span-5`}
      >
        {mutation.isPending ? 'Guardando…' : 'Dar de alta trabajador'}
      </button>
    </form>
  );
}

export default function TrabajadoresPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [soloActivos, setSoloActivos] = useState(true);

  const trabajadoresQuery = useQuery({
    queryKey: ['trabajadores', tipoFiltro, soloActivos],
    queryFn: () =>
      trabajadoresApi.list({
        tipo: tipoFiltro || undefined,
        activo: soloActivos ? true : undefined,
      }),
  });

  const bajaMutation = useMutation({
    mutationFn: (id: string) => trabajadoresApi.remove(id),
    onSuccess: () => {
      toast('Trabajador dado de baja');
      qc.invalidateQueries({ queryKey: ['trabajadores'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const trabajadores = trabajadoresQuery.data ?? [];

  return (
    <div>
      <PageHeader
        title="Trabajadores"
        subtitle="Maestro de personal propio y subcontratado, con su tarifa habitual"
      >
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={soloActivos}
            onChange={(e) => setSoloActivos(e.target.checked)}
          />
          Solo activos
        </label>
        <select
          className={selectCls}
          value={tipoFiltro}
          onChange={(e) => setTipoFiltro(e.target.value)}
        >
          <option value="">Todos los tipos</option>
          {TRABAJADOR_TIPOS.map((t) => (
            <option key={t} value={t}>
              {TRABAJADOR_TIPO_LABELS[t]}
            </option>
          ))}
        </select>
      </PageHeader>

      <div className="space-y-8">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">Nuevo trabajador</h2>
          <TrabajadorQuickForm />
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">
            Trabajadores dados de alta
          </h2>
          {trabajadoresQuery.isError && (
            <ErrorBanner message={errText(trabajadoresQuery.error)} />
          )}
          {trabajadoresQuery.isLoading && <TableSkeleton rows={3} />}
          {!trabajadoresQuery.isLoading && trabajadores.length === 0 && (
            <EmptyState
              icon={<IconUsers size={26} />}
              title="Sin trabajadores todavía"
            >
              <p className="mx-auto max-w-md text-sm text-gray-500">
                Da de alta el primer operario con el formulario de arriba.
              </p>
            </EmptyState>
          )}
          {trabajadores.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                    <th className="px-4 py-2.5 font-medium">Trabajador</th>
                    <th className="px-4 py-2.5 font-medium">Tipo</th>
                    <th className="px-4 py-2.5 font-medium">Tarifa ord.</th>
                    <th className="px-4 py-2.5 font-medium">Estado</th>
                    <th className="px-4 py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {trabajadores.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-gray-100 hover:bg-gray-50/60 last:border-0"
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{t.nombre}</div>
                        {t.documentoIdentidad && (
                          <div className="text-xs text-gray-400">
                            {t.documentoIdentidad}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">
                        {TRABAJADOR_TIPO_LABELS[t.tipo]}
                        {t.proveedorNombre && ` · ${t.proveedorNombre}`}
                      </td>
                      <td className="px-4 py-2.5 text-xs tabular-nums">
                        {t.ordinaryRateDefault !== null
                          ? `${t.ordinaryRateDefault.toFixed(2)} €/h`
                          : '—'}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-xs font-medium ${
                          t.activo ? 'text-emerald-700' : 'text-gray-400'
                        }`}
                      >
                        {t.activo ? 'Activo' : 'De baja'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {t.activo && (
                          <button
                            type="button"
                            onClick={() => bajaMutation.mutate(t.id)}
                            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600"
                          >
                            <IconTrash size={12} />
                            Dar de baja
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

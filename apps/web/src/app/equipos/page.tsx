'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import {
  EQUIPO_ESTADO_LABELS,
  EQUIPO_ESTADOS,
  EQUIPO_TIPO_LABELS,
  EQUIPO_TIPOS,
  MANTENIMIENTO_TIPO_LABELS,
  MANTENIMIENTO_TIPOS,
  MAQUINARIA_OWNERSHIP_LABELS,
  todayIso,
  type EquipoEstado,
  type EquipoTipo,
  type MaquinariaOwnership,
  type MantenimientoTipo,
} from '@erp/shared';
import { equiposApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconTruck, IconWrench } from '@/components/icons';
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

const ESTADO_BADGE: Record<EquipoEstado, string> = {
  operativo: 'text-emerald-600',
  en_mantenimiento: 'text-amber-600',
  averiado: 'text-red-600',
  baja: 'text-gray-400',
};

/** Alta rápida de un equipo del maestro (propio o alquilado). */
function EquipoQuickForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const [nombre, setNombre] = useState('');
  const [matricula, setMatricula] = useState('');
  const [tipo, setTipo] = useState<EquipoTipo>('maquina_pesada');
  const [ownership, setOwnership] = useState<MaquinariaOwnership>('propia');

  const mutation = useMutation({
    mutationFn: () =>
      equiposApi.create({
        nombre,
        matricula: matricula.trim() || null,
        tipo,
        ownership,
        fechaAlta: todayIso(),
      }),
    onSuccess: () => {
      toast('Equipo dado de alta');
      setNombre('');
      setMatricula('');
      qc.invalidateQueries({ queryKey: ['equipos'] });
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
        placeholder="Nombre del equipo"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        required
      />
      <input
        className={fieldCls}
        placeholder="Matrícula / nº serie"
        value={matricula}
        onChange={(e) => setMatricula(e.target.value)}
      />
      <select
        className={selectCls}
        value={tipo}
        onChange={(e) => setTipo(e.target.value as EquipoTipo)}
      >
        {EQUIPO_TIPOS.map((t) => (
          <option key={t} value={t}>
            {EQUIPO_TIPO_LABELS[t]}
          </option>
        ))}
      </select>
      <select
        className={selectCls}
        value={ownership}
        onChange={(e) => setOwnership(e.target.value as MaquinariaOwnership)}
      >
        {Object.entries(MAQUINARIA_OWNERSHIP_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={mutation.isPending}
        className={`${btnPrimaryCls} col-span-2 justify-center sm:col-span-5`}
      >
        {mutation.isPending ? 'Guardando…' : 'Dar de alta equipo'}
      </button>
    </form>
  );
}

/** Alta rápida de un mantenimiento/ITV para un equipo ya dado de alta. */
function MantenimientoQuickForm({ equipoId }: { equipoId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tipo, setTipo] = useState<MantenimientoTipo>('preventivo');
  const [fecha, setFecha] = useState(todayIso());
  const [coste, setCoste] = useState('');
  const [proximaRevisionFecha, setProximaRevisionFecha] = useState('');
  const [descripcion, setDescripcion] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      equiposApi.createMantenimiento({
        equipoId,
        tipo,
        fecha,
        coste: coste.trim() ? Number(coste.replace(',', '.')) : null,
        proximaRevisionFecha: proximaRevisionFecha || null,
        descripcion: descripcion.trim() || null,
      }),
    onSuccess: () => {
      toast('Mantenimiento registrado');
      setCoste('');
      setDescripcion('');
      qc.invalidateQueries({ queryKey: ['equipos'] });
      qc.invalidateQueries({ queryKey: ['mantenimientos', equipoId] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="grid grid-cols-2 gap-2 sm:grid-cols-6"
    >
      <select
        className={selectCls}
        value={tipo}
        onChange={(e) => setTipo(e.target.value as MantenimientoTipo)}
      >
        {MANTENIMIENTO_TIPOS.map((t) => (
          <option key={t} value={t}>
            {MANTENIMIENTO_TIPO_LABELS[t]}
          </option>
        ))}
      </select>
      <input
        type="date"
        className={fieldCls}
        value={fecha}
        onChange={(e) => setFecha(e.target.value)}
      />
      <input
        className={fieldCls}
        inputMode="decimal"
        placeholder="Coste €"
        value={coste}
        onChange={(e) => setCoste(e.target.value)}
      />
      <input
        type="date"
        className={fieldCls}
        title="Próxima revisión"
        value={proximaRevisionFecha}
        onChange={(e) => setProximaRevisionFecha(e.target.value)}
      />
      <input
        className={`${fieldCls} col-span-2 sm:col-span-1`}
        placeholder="Descripción"
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
      />
      <button
        type="submit"
        disabled={mutation.isPending}
        className={`${btnPrimaryCls} col-span-2 justify-center sm:col-span-1`}
      >
        {mutation.isPending ? '…' : 'Añadir'}
      </button>
    </form>
  );
}

function MantenimientosPanel({ equipoId }: { equipoId: string }) {
  const query = useQuery({
    queryKey: ['mantenimientos', equipoId],
    queryFn: () => equiposApi.listMantenimientos(equipoId),
  });
  const mantenimientos = query.data ?? [];

  return (
    <div className="space-y-3 border-t border-gray-100 bg-gray-50/60 p-4">
      <MantenimientoQuickForm equipoId={equipoId} />
      {query.isLoading && <TableSkeleton rows={2} />}
      {mantenimientos.length > 0 && (
        <ul className="space-y-1 text-xs text-gray-600">
          {mantenimientos.map((m) => (
            <li key={m.id} className="flex items-center gap-2">
              <IconWrench size={12} className="shrink-0 text-gray-400" />
              <span className="font-medium">{m.fecha}</span>
              <span>{MANTENIMIENTO_TIPO_LABELS[m.tipo]}</span>
              {m.coste !== null && (
                <span className="tabular-nums">· {m.coste.toFixed(2)} €</span>
              )}
              {m.descripcion && (
                <span className="text-gray-400">· {m.descripcion}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function EquiposPage() {
  const [estadoFiltro, setEstadoFiltro] = useState('');
  const [expandido, setExpandido] = useState<string | null>(null);

  const equiposQuery = useQuery({
    queryKey: ['equipos', estadoFiltro],
    queryFn: () => equiposApi.list({ estado: estadoFiltro || undefined }),
  });

  const equipos = equiposQuery.data ?? [];

  return (
    <div>
      <PageHeader
        title="Maquinaria y equipos"
        subtitle="Maestro de equipos, propiedad/alquiler y su histórico de mantenimientos e ITV"
      >
        <select
          className={selectCls}
          value={estadoFiltro}
          onChange={(e) => setEstadoFiltro(e.target.value)}
        >
          <option value="">Todos los estados</option>
          {EQUIPO_ESTADOS.map((estado) => (
            <option key={estado} value={estado}>
              {EQUIPO_ESTADO_LABELS[estado]}
            </option>
          ))}
        </select>
      </PageHeader>

      <div className="space-y-8">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">Nuevo equipo</h2>
          <EquipoQuickForm />
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">Equipos dados de alta</h2>
          {equiposQuery.isError && (
            <ErrorBanner message={errText(equiposQuery.error)} />
          )}
          {equiposQuery.isLoading && <TableSkeleton rows={3} />}
          {!equiposQuery.isLoading && equipos.length === 0 && (
            <EmptyState
              icon={<IconTruck size={26} />}
              title="Sin equipos todavía"
            >
              <p className="mx-auto max-w-md text-sm text-gray-500">
                Da de alta la primera máquina o vehículo con el formulario de
                arriba.
              </p>
            </EmptyState>
          )}
          {equipos.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                    <th className="px-4 py-2.5 font-medium">Equipo</th>
                    <th className="px-4 py-2.5 font-medium">Tipo</th>
                    <th className="px-4 py-2.5 font-medium">Titularidad</th>
                    <th className="px-4 py-2.5 font-medium">Estado</th>
                    <th className="px-4 py-2.5 font-medium">
                      Próxima revisión
                    </th>
                    <th className="px-4 py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {equipos.map((eq) => (
                    <Fragment key={eq.id}>
                      <tr
                        className="cursor-pointer border-b border-gray-100 hover:bg-gray-50/60 last:border-0"
                        onClick={() =>
                          setExpandido(expandido === eq.id ? null : eq.id)
                        }
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-medium">{eq.nombre}</div>
                          {eq.matricula && (
                            <div className="text-xs text-gray-400">
                              {eq.matricula}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">
                          {EQUIPO_TIPO_LABELS[eq.tipo]}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">
                          {MAQUINARIA_OWNERSHIP_LABELS[eq.ownership]}
                          {eq.proveedorAlquilerNombre &&
                            ` · ${eq.proveedorAlquilerNombre}`}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-xs font-medium ${ESTADO_BADGE[eq.estado]}`}
                        >
                          {EQUIPO_ESTADO_LABELS[eq.estado]}
                        </td>
                        <td className="px-4 py-2.5 text-xs tabular-nums">
                          {eq.proximaRevisionFecha ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs text-gray-400">
                          {expandido === eq.id ? 'Ocultar' : 'Mantenimientos'}
                        </td>
                      </tr>
                      {expandido === eq.id && (
                        <tr>
                          <td colSpan={6} className="p-0">
                            <MantenimientosPanel equipoId={eq.id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
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

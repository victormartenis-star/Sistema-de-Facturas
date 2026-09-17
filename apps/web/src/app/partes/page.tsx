'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  MAQUINARIA_OWNERSHIP_LABELS,
  todayIso,
  type MaquinariaOwnership,
} from '@erp/shared';
import { partesDiariosApi, projectsApi, trabajadoresApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconCalendar, IconCheck } from '@/components/icons';
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

/** Formulario rápido de un parte de personal: pensado para rellenarse en segundos. */
function PersonalQuickForm({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [trabajadorId, setTrabajadorId] = useState('');
  const [workerName, setWorkerName] = useState('');
  const [workDate, setWorkDate] = useState(todayIso());
  const [ordinaryHours, setOrdinaryHours] = useState('8');
  const [overtimeHours, setOvertimeHours] = useState('0');
  const [ordinaryRate, setOrdinaryRate] = useState('');
  const [overtimeRate, setOvertimeRate] = useState('');

  const trabajadoresQuery = useQuery({
    queryKey: ['trabajadores', undefined, true],
    queryFn: () => trabajadoresApi.list({ activo: true }),
  });
  const trabajadores = trabajadoresQuery.data ?? [];

  function elegirTrabajador(id: string) {
    setTrabajadorId(id);
    const t = trabajadores.find((tr) => tr.id === id);
    if (t) {
      setWorkerName(t.nombre);
      if (t.ordinaryRateDefault !== null)
        setOrdinaryRate(String(t.ordinaryRateDefault));
      if (t.overtimeRateDefault !== null)
        setOvertimeRate(String(t.overtimeRateDefault));
    }
  }

  const mutation = useMutation({
    mutationFn: () =>
      partesDiariosApi.createPersonal({
        projectId,
        workerName,
        trabajadorId: trabajadorId || null,
        workDate,
        ordinaryHours: Number(ordinaryHours.replace(',', '.')) || 0,
        overtimeHours: Number(overtimeHours.replace(',', '.')) || 0,
        ordinaryRate: Number(ordinaryRate.replace(',', '.')) || 0,
        overtimeRate: Number(overtimeRate.replace(',', '.')) || 0,
      }),
    onSuccess: () => {
      toast('Parte de personal guardado');
      setTrabajadorId('');
      setWorkerName('');
      qc.invalidateQueries({ queryKey: ['partes-personal'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!projectId || !workerName.trim()) return;
        mutation.mutate();
      }}
      className="grid grid-cols-2 gap-3 sm:grid-cols-6"
    >
      <select
        className={fieldCls}
        value={trabajadorId}
        onChange={(e) => elegirTrabajador(e.target.value)}
      >
        <option value="">Operario libre (sin ficha)…</option>
        {trabajadores.map((t) => (
          <option key={t.id} value={t.id}>
            {t.nombre}
          </option>
        ))}
      </select>
      <input
        className={fieldCls}
        placeholder="Nombre del operario"
        value={workerName}
        onChange={(e) => {
          setWorkerName(e.target.value);
          setTrabajadorId('');
        }}
        required
      />
      <input
        type="date"
        className={fieldCls}
        value={workDate}
        onChange={(e) => setWorkDate(e.target.value)}
      />
      <input
        className={fieldCls}
        inputMode="decimal"
        placeholder="H. ordinarias"
        value={ordinaryHours}
        onChange={(e) => setOrdinaryHours(e.target.value)}
      />
      <input
        className={fieldCls}
        inputMode="decimal"
        placeholder="H. extra"
        value={overtimeHours}
        onChange={(e) => setOvertimeHours(e.target.value)}
      />
      <input
        className={fieldCls}
        inputMode="decimal"
        placeholder="€/h ordinaria"
        value={ordinaryRate}
        onChange={(e) => setOrdinaryRate(e.target.value)}
        required
      />
      <input
        className={`${fieldCls} col-span-2 sm:col-span-1`}
        inputMode="decimal"
        placeholder="€/h extra"
        value={overtimeRate}
        onChange={(e) => setOvertimeRate(e.target.value)}
        required
      />
      <button
        type="submit"
        disabled={!projectId || mutation.isPending}
        className={`${btnPrimaryCls} col-span-2 justify-center sm:col-span-6`}
      >
        {mutation.isPending ? 'Guardando…' : 'Añadir parte de personal'}
      </button>
    </form>
  );
}

/** Formulario rápido de un parte de maquinaria. */
function MaquinariaQuickForm({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [machineName, setMachineName] = useState('');
  const [ownership, setOwnership] = useState<MaquinariaOwnership>('propia');
  const [workDate, setWorkDate] = useState(todayIso());
  const [hoursUsed, setHoursUsed] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [fuelLiters, setFuelLiters] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      partesDiariosApi.createMaquinaria({
        projectId,
        machineName,
        ownership,
        workDate,
        hoursUsed: Number(hoursUsed.replace(',', '.')) || 0,
        hourlyRate: Number(hourlyRate.replace(',', '.')) || 0,
        fuelLiters: fuelLiters.trim()
          ? Number(fuelLiters.replace(',', '.'))
          : null,
      }),
    onSuccess: () => {
      toast('Parte de maquinaria guardado');
      setMachineName('');
      setFuelLiters('');
      qc.invalidateQueries({ queryKey: ['partes-maquinaria'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!projectId || !machineName.trim()) return;
        mutation.mutate();
      }}
      className="grid grid-cols-2 gap-3 sm:grid-cols-6"
    >
      <input
        className={`${fieldCls} col-span-2 sm:col-span-2`}
        placeholder="Máquina / matrícula"
        value={machineName}
        onChange={(e) => setMachineName(e.target.value)}
        required
      />
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
      <input
        type="date"
        className={fieldCls}
        value={workDate}
        onChange={(e) => setWorkDate(e.target.value)}
      />
      <input
        className={fieldCls}
        inputMode="decimal"
        placeholder="Horas de uso"
        value={hoursUsed}
        onChange={(e) => setHoursUsed(e.target.value)}
        required
      />
      <input
        className={fieldCls}
        inputMode="decimal"
        placeholder="€/hora"
        value={hourlyRate}
        onChange={(e) => setHourlyRate(e.target.value)}
        required
      />
      <input
        className={`${fieldCls} col-span-2 sm:col-span-1`}
        inputMode="decimal"
        placeholder="Litros combustible"
        value={fuelLiters}
        onChange={(e) => setFuelLiters(e.target.value)}
      />
      <button
        type="submit"
        disabled={!projectId || mutation.isPending}
        className={`${btnPrimaryCls} col-span-2 justify-center sm:col-span-6`}
      >
        {mutation.isPending ? 'Guardando…' : 'Añadir parte de maquinaria'}
      </button>
    </form>
  );
}

export default function PartesDiariosPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [projectId, setProjectId] = useState('');

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
  });

  const personalQuery = useQuery({
    queryKey: ['partes-personal', projectId],
    queryFn: () =>
      partesDiariosApi.listPersonal({ projectId: projectId || undefined }),
  });
  const maquinariaQuery = useQuery({
    queryKey: ['partes-maquinaria', projectId],
    queryFn: () =>
      partesDiariosApi.listMaquinaria({ projectId: projectId || undefined }),
  });

  const approvePersonal = useMutation({
    mutationFn: (id: string) => partesDiariosApi.approvePersonal(id),
    onSuccess: () => {
      toast('Parte aprobado');
      qc.invalidateQueries({ queryKey: ['partes-personal'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });
  const approveMaquinaria = useMutation({
    mutationFn: (id: string) => partesDiariosApi.approveMaquinaria(id),
    onSuccess: () => {
      toast('Parte aprobado');
      qc.invalidateQueries({ queryKey: ['partes-maquinaria'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const personal = personalQuery.data ?? [];
  const maquinaria = maquinariaQuery.data ?? [];

  return (
    <div>
      <PageHeader
        title="Partes de trabajo diario"
        subtitle="Imputación rápida de personal y maquinaria — el coste real que las facturas todavía no reflejan"
      >
        <select
          className={selectCls}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">Selecciona una obra…</option>
          {projectsQuery.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
      </PageHeader>

      {!projectId && (
        <EmptyState
          icon={<IconCalendar size={26} />}
          title="Elige una obra para empezar"
        >
          <p className="mx-auto max-w-md text-sm text-gray-500">
            Los partes de personal y maquinaria se imputan obra a obra.
          </p>
        </EmptyState>
      )}

      {projectId && (
        <div className="space-y-8">
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">
              Nuevo parte de personal
            </h2>
            <PersonalQuickForm projectId={projectId} />
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">
              Nuevo parte de maquinaria
            </h2>
            <MaquinariaQuickForm projectId={projectId} />
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Partes de personal</h2>
            {personalQuery.isError && (
              <ErrorBanner message={errText(personalQuery.error)} />
            )}
            {personalQuery.isLoading && <TableSkeleton rows={3} />}
            {personal.length > 0 && (
              <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                      <th className="px-4 py-2.5 font-medium">Fecha</th>
                      <th className="px-4 py-2.5 font-medium">Operario</th>
                      <th className="px-4 py-2.5 text-right font-medium">
                        H. ord.
                      </th>
                      <th className="px-4 py-2.5 text-right font-medium">
                        H. extra
                      </th>
                      <th className="px-4 py-2.5 text-right font-medium">
                        Coste
                      </th>
                      <th className="px-4 py-2.5 font-medium">Aprobación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {personal.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-gray-100 last:border-0"
                      >
                        <td className="px-4 py-2.5 text-xs">{p.workDate}</td>
                        <td className="px-4 py-2.5">{p.workerName}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {p.ordinaryHours}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {p.overtimeHours}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                          {p.totalCost.toFixed(2)} €
                        </td>
                        <td className="px-4 py-2.5">
                          {p.approvedAt ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                              <IconCheck size={12} /> Aprobado
                            </span>
                          ) : (
                            <button
                              className="text-xs font-medium text-amber-600 hover:text-amber-800"
                              onClick={() => approvePersonal.mutate(p.id)}
                            >
                              Aprobar
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

          <section>
            <h2 className="mb-2 text-sm font-semibold">Partes de maquinaria</h2>
            {maquinariaQuery.isError && (
              <ErrorBanner message={errText(maquinariaQuery.error)} />
            )}
            {maquinariaQuery.isLoading && <TableSkeleton rows={3} />}
            {maquinaria.length > 0 && (
              <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                      <th className="px-4 py-2.5 font-medium">Fecha</th>
                      <th className="px-4 py-2.5 font-medium">Máquina</th>
                      <th className="px-4 py-2.5 font-medium">Titularidad</th>
                      <th className="px-4 py-2.5 text-right font-medium">
                        Horas
                      </th>
                      <th className="px-4 py-2.5 text-right font-medium">
                        Coste
                      </th>
                      <th className="px-4 py-2.5 font-medium">Aprobación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maquinaria.map((m) => (
                      <tr
                        key={m.id}
                        className="border-b border-gray-100 last:border-0"
                      >
                        <td className="px-4 py-2.5 text-xs">{m.workDate}</td>
                        <td className="px-4 py-2.5">{m.machineName}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">
                          {MAQUINARIA_OWNERSHIP_LABELS[m.ownership]}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {m.hoursUsed}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                          {m.totalCost.toFixed(2)} €
                        </td>
                        <td className="px-4 py-2.5">
                          {m.approvedAt ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                              <IconCheck size={12} /> Aprobado
                            </span>
                          ) : (
                            <button
                              className="text-xs font-medium text-amber-600 hover:text-amber-800"
                              onClick={() => approveMaquinaria.mutate(m.id)}
                            >
                              Aprobar
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
      )}
    </div>
  );
}

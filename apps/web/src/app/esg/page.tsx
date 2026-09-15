'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ESG_CATEGORIA_LABELS,
  RCD_TREATMENT_LABELS,
  RCD_UNITS,
  type EsgCategoria,
  type RcdTreatment,
  type RcdUnit,
} from '@erp/shared';
import { contactsApi, esgApi, formatDate, projectsApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconLeaf, IconPlus, IconTrash } from '@/components/icons';
import {
  ErrorBanner,
  Modal,
  PageHeader,
  TableSkeleton,
  btnGhostCls,
  btnPrimaryCls,
  fieldCls,
  labelCls,
  selectCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

export default function EsgPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState('');
  const [factorOpen, setFactorOpen] = useState(false);
  const [registroOpen, setRegistroOpen] = useState(false);
  const [valeOpen, setValeOpen] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ['projects-for-esg'],
    queryFn: () => projectsApi.list('', ''),
  });
  const factoresQuery = useQuery({
    queryKey: ['esg-factores'],
    queryFn: () => esgApi.listFactores(true),
  });
  const registrosQuery = useQuery({
    queryKey: ['esg-registros', projectId],
    queryFn: () => esgApi.listRegistros(projectId || undefined),
    enabled: !!projectId,
  });
  const informeQuery = useQuery({
    queryKey: ['esg-informe', projectId],
    queryFn: () => esgApi.informe(projectId),
    enabled: !!projectId,
  });
  const valesQuery = useQuery({
    queryKey: ['rcd-vales', projectId],
    queryFn: () => esgApi.listVales(projectId || undefined),
    enabled: !!projectId,
  });
  const informeRcdQuery = useQuery({
    queryKey: ['rcd-informe', projectId],
    queryFn: () => esgApi.informeRcd(projectId),
    enabled: !!projectId,
  });

  const invalidateEmisiones = () => {
    queryClient.invalidateQueries({ queryKey: ['esg-registros'] });
    queryClient.invalidateQueries({ queryKey: ['esg-informe'] });
  };
  const invalidateRcd = () => {
    queryClient.invalidateQueries({ queryKey: ['rcd-vales'] });
    queryClient.invalidateQueries({ queryKey: ['rcd-informe'] });
  };

  const removeRegistroMutation = useMutation({
    mutationFn: (id: string) => esgApi.removeRegistro(id),
    onSuccess: invalidateEmisiones,
    onError: (e) => toast(errText(e), 'error'),
  });
  const removeValeMutation = useMutation({
    mutationFn: (id: string) => esgApi.removeVale(id),
    onSuccess: invalidateRcd,
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <div>
      <PageHeader
        title="Sostenibilidad y RCD"
        subtitle="Huella de carbono por obra y trazabilidad de residuos de construcción y demolición"
      >
        <select
          className={selectCls}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">Elige una obra…</option>
          {projectsQuery.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
      </PageHeader>

      {!projectId && (
        <p className="text-sm text-gray-400">
          Elige una obra para ver su huella de carbono y trazabilidad de
          residuos.
        </p>
      )}

      {projectId && (
        <div className="space-y-6">
          {/* Huella de carbono */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <IconLeaf size={14} /> Huella de carbono
              </h2>
              <div className="flex gap-2">
                <button
                  className={btnGhostCls}
                  onClick={() => setFactorOpen(true)}
                >
                  <IconPlus size={13} /> Factor
                </button>
                <button
                  className={btnPrimaryCls}
                  onClick={() => setRegistroOpen(true)}
                >
                  <IconPlus size={13} /> Consumo
                </button>
              </div>
            </div>

            {informeQuery.data && (
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Total"
                  value={`${informeQuery.data.totalToneladasCo2e.toFixed(3)} t CO₂e`}
                />
                {informeQuery.data.porCategoria.slice(0, 3).map((c) => (
                  <Stat
                    key={c.categoria}
                    label={ESG_CATEGORIA_LABELS[c.categoria]}
                    value={`${c.emisionesKgCo2e.toFixed(1)} kg`}
                  />
                ))}
              </div>
            )}

            {registrosQuery.isLoading && <TableSkeleton rows={3} />}
            {registrosQuery.error && (
              <ErrorBanner message={errText(registrosQuery.error)} />
            )}
            <div className="divide-y divide-gray-100">
              {registrosQuery.data?.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span>
                    {r.factorNombre}{' '}
                    <span className="text-xs text-gray-400">
                      ({formatDate(r.fecha)})
                    </span>
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-gray-600">
                      {r.cantidad} {r.unidad} → {r.emisionesKgCo2e.toFixed(2)}{' '}
                      kg CO₂e
                    </span>
                    <button
                      className="text-gray-400 hover:text-red-600"
                      onClick={() => removeRegistroMutation.mutate(r.id)}
                    >
                      <IconTrash size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {registrosQuery.data?.length === 0 && (
                <p className="py-2 text-sm text-gray-400">
                  Sin consumos registrados.
                </p>
              )}
            </div>
          </div>

          {/* RCD */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                Trazabilidad de residuos (RCD)
              </h2>
              <button
                className={btnPrimaryCls}
                onClick={() => setValeOpen(true)}
              >
                <IconPlus size={13} /> Vale
              </button>
            </div>

            {informeRcdQuery.data && (
              <div className="mb-4 grid grid-cols-3 gap-3">
                <Stat
                  label="Total toneladas"
                  value={`${informeRcdQuery.data.totalToneladas} tn`}
                />
                <Stat
                  label="Total m³"
                  value={`${informeRcdQuery.data.totalM3} m³`}
                />
                <Stat
                  label="% valorizado"
                  value={
                    informeRcdQuery.data.valorizacionPct !== null
                      ? `${informeRcdQuery.data.valorizacionPct}%`
                      : '—'
                  }
                />
              </div>
            )}

            {valesQuery.isLoading && <TableSkeleton rows={3} />}
            {valesQuery.error && (
              <ErrorBanner message={errText(valesQuery.error)} />
            )}
            <div className="divide-y divide-gray-100">
              {valesQuery.data?.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span>
                    <span className="font-mono text-xs text-gray-500">
                      {v.lerCode}
                    </span>{' '}
                    {v.description}{' '}
                    <span className="text-xs text-gray-400">
                      · {v.managerName} · vale {v.ticketNumber} (
                      {formatDate(v.ticketDate)})
                    </span>
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-gray-600">
                      {v.quantity} {v.unit}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        v.treatment === 'valorizacion'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {RCD_TREATMENT_LABELS[v.treatment]}
                    </span>
                    <button
                      className="text-gray-400 hover:text-red-600"
                      onClick={() => removeValeMutation.mutate(v.id)}
                    >
                      <IconTrash size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {valesQuery.data?.length === 0 && (
                <p className="py-2 text-sm text-gray-400">Sin vales todavía.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <NewFactorModal open={factorOpen} onClose={() => setFactorOpen(false)} />
      {projectId && (
        <>
          <NewRegistroModal
            open={registroOpen}
            onClose={() => setRegistroOpen(false)}
            projectId={projectId}
            factores={factoresQuery.data ?? []}
            onDone={invalidateEmisiones}
          />
          <NewValeModal
            open={valeOpen}
            onClose={() => setValeOpen(false)}
            projectId={projectId}
            onDone={invalidateRcd}
          />
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function NewFactorModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [categoria, setCategoria] = useState<EsgCategoria>('combustible');
  const [nombre, setNombre] = useState('');
  const [unidad, setUnidad] = useState('');
  const [factorKgCo2e, setFactorKgCo2e] = useState('0');

  const mutation = useMutation({
    mutationFn: () =>
      esgApi.createFactor({
        categoria,
        nombre: nombre.trim(),
        unidad: unidad.trim(),
        factorKgCo2e: Number(factorKgCo2e) || 0,
      }),
    onSuccess: () => {
      toast('Factor creado', 'success');
      queryClient.invalidateQueries({ queryKey: ['esg-factores'] });
      onClose();
      setNombre('');
      setUnidad('');
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Nuevo factor de emisión">
      <div className="space-y-3">
        <div className={fieldCls}>
          <label className={labelCls}>Categoría</label>
          <select
            className={selectCls}
            value={categoria}
            onChange={(e) => setCategoria(e.target.value as EsgCategoria)}
          >
            {Object.entries(ESG_CATEGORIA_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Nombre</label>
          <input
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="Gasóleo B, Electricidad red…"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label className={labelCls}>Unidad</label>
            <input
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="litro, kWh, kg…"
              value={unidad}
              onChange={(e) => setUnidad(e.target.value)}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>kg CO₂e / unidad</label>
            <input
              type="number"
              step="0.0001"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={factorKgCo2e}
              onChange={(e) => setFactorKgCo2e(e.target.value)}
            />
          </div>
        </div>
        <button
          className={`${btnPrimaryCls} w-full justify-center`}
          disabled={!nombre.trim() || !unidad.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Crear
        </button>
      </div>
    </Modal>
  );
}

function NewRegistroModal({
  open,
  onClose,
  projectId,
  factores,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  factores: { id: string; nombre: string; unidad: string }[];
  onDone: () => void;
}) {
  const toast = useToast();
  const [factorId, setFactorId] = useState('');
  const [cantidad, setCantidad] = useState('0');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));

  const mutation = useMutation({
    mutationFn: () =>
      esgApi.createRegistro({
        projectId,
        factorId,
        fecha,
        cantidad: Number(cantidad) || 0,
      }),
    onSuccess: () => {
      toast('Consumo registrado', 'success');
      onDone();
      onClose();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Nuevo consumo">
      <div className="space-y-3">
        <div className={fieldCls}>
          <label className={labelCls}>Factor</label>
          <select
            className={selectCls}
            value={factorId}
            onChange={(e) => setFactorId(e.target.value)}
          >
            <option value="">Selecciona…</option>
            {factores.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre} ({f.unidad})
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label className={labelCls}>Cantidad</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Fecha</label>
            <input
              type="date"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
        </div>
        <button
          className={`${btnPrimaryCls} w-full justify-center`}
          disabled={!factorId || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Registrar
        </button>
      </div>
    </Modal>
  );
}

function NewValeModal({
  open,
  onClose,
  projectId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [lerCode, setLerCode] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('0');
  const [unit, setUnit] = useState<RcdUnit>('tn');
  const [treatment, setTreatment] = useState<RcdTreatment>('valorizacion');
  const [managerContactId, setManagerContactId] = useState('');
  const [ticketNumber, setTicketNumber] = useState('');
  const [ticketDate, setTicketDate] = useState(
    new Date().toISOString().slice(0, 10),
  );

  const contactsQuery = useQuery({
    queryKey: ['contacts-for-rcd'],
    queryFn: () => contactsApi.list('', ''),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      esgApi.createVale({
        projectId,
        lerCode: lerCode.trim(),
        description: description.trim(),
        quantity: Number(quantity) || 0,
        unit,
        treatment,
        managerContactId,
        ticketNumber: ticketNumber.trim(),
        ticketDate,
      }),
    onSuccess: () => {
      toast('Vale registrado', 'success');
      onDone();
      onClose();
      setLerCode('');
      setDescription('');
      setTicketNumber('');
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Nuevo vale de entrega a planta">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label className={labelCls}>Código LER</label>
            <input
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="17 01 01"
              value={lerCode}
              onChange={(e) => setLerCode(e.target.value)}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Tratamiento</label>
            <select
              className={selectCls}
              value={treatment}
              onChange={(e) => setTreatment(e.target.value as RcdTreatment)}
            >
              {Object.entries(RCD_TREATMENT_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Descripción del residuo</label>
          <input
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label className={labelCls}>Cantidad</label>
            <input
              type="number"
              step="0.001"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Unidad</label>
            <select
              className={selectCls}
              value={unit}
              onChange={(e) => setUnit(e.target.value as RcdUnit)}
            >
              {RCD_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Gestor autorizado</label>
          <select
            className={selectCls}
            value={managerContactId}
            onChange={(e) => setManagerContactId(e.target.value)}
          >
            <option value="">Selecciona…</option>
            {contactsQuery.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label className={labelCls}>Nº de vale</label>
            <input
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={ticketNumber}
              onChange={(e) => setTicketNumber(e.target.value)}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Fecha</label>
            <input
              type="date"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={ticketDate}
              onChange={(e) => setTicketDate(e.target.value)}
            />
          </div>
        </div>
        <button
          className={`${btnPrimaryCls} w-full justify-center`}
          disabled={
            !lerCode.trim() ||
            !description.trim() ||
            !managerContactId ||
            !ticketNumber.trim() ||
            mutation.isPending
          }
          onClick={() => mutation.mutate()}
        >
          Registrar vale
        </button>
      </div>
    </Modal>
  );
}

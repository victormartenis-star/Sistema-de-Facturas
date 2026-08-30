'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  VARIATION_KINDS,
  VARIATION_KIND_LABELS,
  type VariationDto,
  type VariationStatus,
} from '@erp/shared';
import { formatDate, formatEur, projectsApi, variationsApi } from '@/lib/api';
import { IconAlertTriangle, IconFileText } from '@/components/icons';
import { useToast } from '@/components/toast';
import {
  EmptyState,
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

const today = () => new Date().toISOString().slice(0, 10);

const STATUS_TONE: Record<VariationStatus, string> = {
  aprobado: 'border-emerald-200 bg-emerald-50/50',
  pendiente: 'border-amber-200 bg-amber-50/40',
  rechazado: 'border-gray-200 bg-gray-50/60',
};

/** Un bloque del informe. Aprobado, pendiente y rechazado nunca se mezclan. */
function VariationBlock({
  title,
  hint,
  status,
  items,
  onApprove,
  onReject,
  onReopen,
}: {
  title: string;
  hint: string;
  status: VariationStatus;
  items: VariationDto[];
  onApprove: (v: VariationDto, by: 'df' | 'propiedad') => void;
  onReject: (v: VariationDto) => void;
  onReopen: (v: VariationDto) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className={`mb-6 rounded-2xl border p-5 ${STATUS_TONE[status]}`}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mb-4 text-xs text-gray-500">{hint}</p>
      <div className="space-y-3">
        {items.map((v) => (
          <article
            key={v.id}
            className="rounded-xl border border-gray-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs font-semibold">
                  {v.variationNumber}
                  <span className="ml-2 font-sans font-normal text-gray-500">
                    {VARIATION_KIND_LABELS[v.kind]}
                  </span>
                  {v.executed && (
                    <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-orange-700">
                      EN EJECUCIÓN
                    </span>
                  )}
                </p>
                <p className="mt-1 text-sm">{v.description}</p>
                <p className="mt-1 text-[11px] text-gray-500">
                  Solicitado {formatDate(v.requestedAt)}
                  {v.status === 'pendiente' && ` · ${v.ageDays} días`}
                  {v.clientOrderRef && ` · Orden: ${v.clientOrderRef}`}
                  {v.rejectionReason && ` · Motivo: ${v.rejectionReason}`}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={`text-lg font-bold tabular-nums ${
                    v.salesVariation < 0 ? 'text-gray-600' : ''
                  }`}
                >
                  {v.salesVariation > 0 ? '+' : ''}
                  {formatEur(v.salesVariation)}
                </p>
                <p className="text-[11px] text-gray-500">
                  Coste {formatEur(v.costVariation)} · Margen{' '}
                  <span className={v.variationMargin < 0 ? 'text-red-600' : ''}>
                    {formatEur(v.variationMargin)}
                  </span>
                </p>
              </div>
            </div>

            {v.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-lg bg-amber-50 p-2.5">
                {v.warnings.map((w) => (
                  <li
                    key={w}
                    className="flex gap-1.5 text-[11px] text-amber-800"
                  >
                    <IconAlertTriangle size={13} className="mt-px shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
              <span className="text-gray-500">
                DF:{' '}
                {v.dfApprovedAt ? (
                  <strong className="text-emerald-700">
                    {formatDate(v.dfApprovedAt)}
                  </strong>
                ) : (
                  '—'
                )}
              </span>
              <span className="text-gray-500">
                Propiedad:{' '}
                {v.ownerApprovedAt ? (
                  <strong className="text-emerald-700">
                    {formatDate(v.ownerApprovedAt)}
                  </strong>
                ) : (
                  '—'
                )}
              </span>
              <span className="ml-auto flex gap-3">
                {v.status !== 'rechazado' && !v.dfApprovedAt && (
                  <button
                    className="text-gray-500 hover:text-gray-900"
                    onClick={() => onApprove(v, 'df')}
                  >
                    Firma DF
                  </button>
                )}
                {v.status !== 'rechazado' && !v.ownerApprovedAt && (
                  <button
                    className="text-gray-500 hover:text-gray-900"
                    onClick={() => onApprove(v, 'propiedad')}
                  >
                    Firma Propiedad
                  </button>
                )}
                {v.status === 'pendiente' && (
                  <button
                    className="text-gray-500 hover:text-red-600"
                    onClick={() => onReject(v)}
                  >
                    Rechazar
                  </button>
                )}
                {v.status !== 'pendiente' && (
                  <button
                    className="text-gray-500 hover:text-gray-900"
                    onClick={() => onReopen(v)}
                  >
                    Reabrir
                  </button>
                )}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function ModificadosPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [projectId, setProjectId] = useState('');
  const [creating, setCreating] = useState(false);
  const [rejecting, setRejecting] = useState<VariationDto | null>(null);
  const [reason, setReason] = useState('');
  const [form, setForm] = useState({
    kind: 'modificado',
    description: '',
    salesVariation: '',
    costVariation: '',
    requestedAt: today(),
    executed: false,
    clientOrderRef: '',
  });

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!projectId && projectsQuery.data?.length) {
      setProjectId(projectsQuery.data[0].id);
    }
  }, [projectId, projectsQuery.data]);

  const query = useQuery({
    queryKey: ['modificados', projectId],
    queryFn: () => variationsApi.report(projectId),
    enabled: Boolean(projectId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['modificados'] });
    // El presupuesto actualizado alimenta la economía de la obra
    qc.invalidateQueries({ queryKey: ['economia'] });
  };

  const num = (s: string) => Number(s.replace(',', '.')) || 0;

  const create = useMutation({
    mutationFn: () =>
      variationsApi.create({
        projectId,
        kind: form.kind as (typeof VARIATION_KINDS)[number],
        description: form.description,
        salesVariation: num(form.salesVariation),
        costVariation: num(form.costVariation),
        requestedAt: form.requestedAt,
        executed: form.executed,
        clientOrderRef: form.clientOrderRef || null,
      }),
    onSuccess: (v) => {
      toast(`Modificación ${v.variationNumber} registrada`);
      setCreating(false);
      setForm({
        ...form,
        description: '',
        salesVariation: '',
        costVariation: '',
      });
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const approve = useMutation({
    mutationFn: ({ id, by }: { id: string; by: 'df' | 'propiedad' }) =>
      variationsApi.approve(id, { by, date: today() }),
    onSuccess: (v) => {
      toast(
        v.status === 'aprobado'
          ? `${v.variationNumber} aprobado: entra en el presupuesto actualizado`
          : 'Firma registrada. Falta la otra aprobación para que compute.',
      );
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const reject = useMutation({
    mutationFn: () =>
      variationsApi.reject(rejecting!.id, { date: today(), reason }),
    onSuccess: () => {
      toast('Modificación rechazada');
      setRejecting(null);
      setReason('');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const reopen = useMutation({
    mutationFn: (id: string) => variationsApi.reopen(id),
    onSuccess: () => {
      toast('Vuelve a estar pendiente');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const r = query.data;
  const i = r?.impact;

  /** `signed` solo en las variaciones: un presupuesto no lleva signo «+». */
  const ImpactRow = ({
    label,
    amount,
    strong = false,
    muted = false,
    signed = false,
  }: {
    label: string;
    amount: number;
    strong?: boolean;
    muted?: boolean;
    signed?: boolean;
  }) => (
    <tr className={strong ? 'bg-gray-50 font-semibold' : ''}>
      <td className={`px-4 py-2.5 ${muted ? 'text-gray-500' : ''}`}>{label}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        {signed && amount > 0 ? '+' : ''}
        {formatEur(amount)}
      </td>
    </tr>
  );

  return (
    <div>
      <PageHeader
        title="Modificados y contradictorios"
        subtitle="Solo computan con la firma de la DF y de la Propiedad"
      >
        <select
          className={selectCls}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          {projectsQuery.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
        <button className={btnPrimaryCls} onClick={() => setCreating(true)}>
          Nueva modificación
        </button>
      </PageHeader>

      {query.isError && <ErrorBanner message={errText(query.error)} />}
      {query.isLoading && <TableSkeleton rows={4} />}

      {r && i && (
        <>
          {r.warnings.length > 0 && (
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
                <IconAlertTriangle size={16} />
                Atención
              </p>
              <ul className="space-y-1.5">
                {r.warnings.map((w) => (
                  <li key={w} className="text-sm text-amber-800">
                    · {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mb-8 grid gap-6 lg:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
              <p className="border-b border-gray-200 bg-gray-50/60 px-4 py-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                Impacto sobre el presupuesto
              </p>
              <table className="w-full text-sm">
                <tbody>
                  <ImpactRow
                    label="Presupuesto contractual inicial"
                    amount={i.initialBudget}
                  />
                  <ImpactRow
                    label="Modificaciones aprobadas al alza"
                    signed
                    amount={i.approvedIncrease}
                  />
                  <ImpactRow
                    label="Modificaciones aprobadas a la baja"
                    signed
                    amount={i.approvedDecrease}
                  />
                  <ImpactRow
                    label="Presupuesto actualizado aprobado"
                    amount={i.updatedBudget}
                    strong
                  />
                  <ImpactRow
                    label="Incrementos pendientes"
                    signed
                    amount={i.pendingIncrease}
                    muted
                  />
                  <ImpactRow
                    label="Reducciones pendientes"
                    signed
                    amount={i.pendingDecrease}
                    muted
                  />
                  <ImpactRow
                    label="Impacto potencial pendiente de aprobación"
                    signed
                    amount={i.potentialImpact}
                    muted
                  />
                </tbody>
              </table>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
                Coste ejecutado sin aprobar
              </p>
              <p
                className={`mt-1 text-3xl font-bold tabular-nums ${
                  i.executedNotApprovedCost > 0 ? 'text-red-600' : ''
                }`}
              >
                {formatEur(i.executedNotApprovedCost)}
              </p>
              <p className="mt-2 text-sm text-gray-600">
                {i.executedNotApprovedCount === 0
                  ? 'Nada se está ejecutando sin aprobación. Es como debe estar.'
                  : `${i.executedNotApprovedCount} modificación(es) en marcha sin la firma de la Propiedad. Es coste que corre sin ingreso que lo respalde: la forma más rápida de perder margen.`}
              </p>
              <p className="mt-4 border-t border-gray-100 pt-3 text-[11px] text-gray-500">
                Ningún trabajo fuera de contrato debería ejecutarse sin orden
                escrita del cliente registrada por el Jefe de Obra y valorada
                por Estudios.
              </p>
            </div>
          </div>

          <VariationBlock
            title="Aprobadas por DF y Propiedad"
            hint="Incorporadas al presupuesto de venta actualizado."
            status="aprobado"
            items={r.approved}
            onApprove={(v, by) => approve.mutate({ id: v.id, by })}
            onReject={setRejecting}
            onReopen={(v) => reopen.mutate(v.id)}
          />
          <VariationBlock
            title="Pendientes de aprobación"
            hint="No computan como ingreso. Carácter informativo y de seguimiento hasta su validación formal."
            status="pendiente"
            items={r.pending}
            onApprove={(v, by) => approve.mutate({ id: v.id, by })}
            onReject={setRejecting}
            onReopen={(v) => reopen.mutate(v.id)}
          />
          <VariationBlock
            title="Solicitadas y no aprobadas"
            hint="No computan. Se mantiene el registro para la liquidación."
            status="rechazado"
            items={r.rejected}
            onApprove={(v, by) => approve.mutate({ id: v.id, by })}
            onReject={setRejecting}
            onReopen={(v) => reopen.mutate(v.id)}
          />

          {r.approved.length + r.pending.length + r.rejected.length === 0 && (
            <EmptyState
              icon={<IconFileText size={26} />}
              title="Esta obra no tiene modificaciones registradas"
            />
          )}
        </>
      )}

      <Modal
        open={creating}
        title="Nueva modificación"
        onClose={() => setCreating(false)}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div>
            <label className={labelCls}>Tipo</label>
            <select
              className={selectCls}
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
            >
              {VARIATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {VARIATION_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Descripción de la modificación</label>
            <input
              className={fieldCls}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="Estructura: incremento de medición de acero"
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={labelCls}>Variación de venta (€)</label>
              <input
                className={fieldCls}
                inputMode="decimal"
                value={form.salesVariation}
                onChange={(e) =>
                  setForm({ ...form, salesVariation: e.target.value })
                }
                placeholder="180000 o -25000"
                required
              />
            </div>
            <div>
              <label className={labelCls}>Coste asociado (€)</label>
              <input
                className={fieldCls}
                inputMode="decimal"
                value={form.costVariation}
                onChange={(e) =>
                  setForm({ ...form, costVariation: e.target.value })
                }
                placeholder="150000"
              />
            </div>
            <div>
              <label className={labelCls}>Fecha de solicitud</label>
              <input
                type="date"
                className={fieldCls}
                value={form.requestedAt}
                onChange={(e) =>
                  setForm({ ...form, requestedAt: e.target.value })
                }
                required
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Orden escrita del cliente</label>
            <input
              className={fieldCls}
              value={form.clientOrderRef}
              onChange={(e) =>
                setForm({ ...form, clientOrderRef: e.target.value })
              }
              placeholder="Correo, acta o referencia del encargo"
            />
          </div>
          <label className="flex items-start gap-2 rounded-lg bg-orange-50 p-3">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.executed}
              onChange={(e) => setForm({ ...form, executed: e.target.checked })}
            />
            <span className="text-xs text-orange-800">
              <span className="font-semibold">Ya se está ejecutando</span> — si
              todavía no está aprobada, su coste corre sin ingreso que lo
              respalde y el sistema lo destacará.
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className={btnGhostCls}
              onClick={() => setCreating(false)}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={create.isPending}
            >
              {create.isPending ? 'Guardando…' : 'Registrar'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={rejecting !== null}
        title={`Rechazar ${rejecting?.variationNumber ?? ''}`}
        onClose={() => setRejecting(null)}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            reject.mutate();
          }}
        >
          <div>
            <label className={labelCls}>Motivo de la negativa</label>
            <textarea
              className={fieldCls}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Se conserva el registro para la liquidación"
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={btnGhostCls}
              onClick={() => setRejecting(null)}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={reject.isPending}
            >
              Rechazar
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

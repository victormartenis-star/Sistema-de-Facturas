'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  PERMIT_COUNTERPARTIES,
  PERMIT_KINDS,
  PERMIT_KIND_LABELS,
  PERMIT_STATUS_LABELS,
  REFERENCE_LEAD_DAYS,
  type PermitDto,
  type PermitKind,
  type PermitLight,
} from '@erp/shared';
import { formatDate, formatEur, permitsApi, projectsApi } from '@/lib/api';
import { IconAlertTriangle, IconCalendar } from '@/components/icons';
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

const LIGHT_DOT: Record<PermitLight, string> = {
  verde: 'bg-emerald-500',
  ambar: 'bg-amber-500',
  rojo: 'bg-red-500',
};

const LIGHT_ROW: Record<PermitLight, string> = {
  verde: '',
  ambar: 'bg-amber-50/50',
  rojo: 'bg-red-50/50',
};

/** Meses aproximados del plazo de referencia, para el texto de ayuda. */
const leadMonths = (kind: PermitKind) =>
  Math.round(REFERENCE_LEAD_DAYS[kind] / 30);

export default function TramitesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [projectId, setProjectId] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PermitDto | null>(null);

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
    queryKey: ['tramites', projectId],
    queryFn: () => permitsApi.board(projectId),
    enabled: Boolean(projectId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['tramites'] });

  const [form, setForm] = useState({
    kind: 'acometida_agua' as PermitKind,
    counterparty: '',
    reference: '',
    requestedAt: '',
    committedAt: '',
    grantedAt: '',
    neededBy: '',
    cost: '',
    notApplicable: false,
    notes: '',
  });

  const openCreate = () => {
    setEditing(null);
    setForm({
      kind: 'acometida_agua',
      counterparty: '',
      reference: '',
      requestedAt: '',
      committedAt: '',
      grantedAt: '',
      neededBy: '',
      cost: '',
      notApplicable: false,
      notes: '',
    });
    setCreating(true);
  };

  const openEdit = (p: PermitDto) => {
    setEditing(p);
    setForm({
      kind: p.kind,
      counterparty: p.counterparty ?? '',
      reference: p.reference ?? '',
      requestedAt: p.requestedAt ?? '',
      committedAt: p.committedAt ?? '',
      grantedAt: p.grantedAt ?? '',
      neededBy: p.neededBy ?? '',
      cost: p.cost === null ? '' : String(p.cost),
      notApplicable: p.notApplicable,
      notes: p.notes ?? '',
    });
    setCreating(true);
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        kind: form.kind,
        counterparty: form.counterparty || null,
        reference: form.reference || null,
        requestedAt: form.requestedAt || null,
        committedAt: form.committedAt || null,
        grantedAt: form.grantedAt || null,
        neededBy: form.neededBy || null,
        cost: form.cost ? Number(form.cost.replace(',', '.')) : null,
        notApplicable: form.notApplicable,
        notes: form.notes || null,
      };
      return editing
        ? permitsApi.update(editing.id, payload)
        : permitsApi.create({ ...payload, projectId });
    },
    onSuccess: () => {
      toast(editing ? 'Trámite actualizado' : 'Trámite registrado');
      setCreating(false);
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  /** Atajo del día a día: dar por concedido con la fecha de hoy. */
  const grant = useMutation({
    mutationFn: (p: PermitDto) =>
      permitsApi.update(p.id, { grantedAt: today() }),
    onSuccess: () => {
      toast('Trámite concedido');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const b = query.data;

  return (
    <div>
      <PageHeader
        title="Licencias y acometidas"
        subtitle="La etapa que marca el plazo de la obra"
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
        <button className={btnPrimaryCls} onClick={openCreate}>
          Nuevo trámite
        </button>
      </PageHeader>

      {query.isError && <ErrorBanner message={errText(query.error)} />}
      {query.isLoading && <TableSkeleton rows={5} />}

      {b && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-4">
            {(['verde', 'ambar', 'rojo'] as PermitLight[]).map((l) => (
              <div
                key={l}
                className="rounded-xl border border-gray-200 bg-white p-4"
              >
                <p className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                  <span className={`h-2 w-2 rounded-full ${LIGHT_DOT[l]}`} />
                  {l === 'verde'
                    ? 'En plazo'
                    : l === 'ambar'
                      ? 'Vigilar'
                      : 'Comprometen la entrega'}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {b.counts[l]}
                </p>
              </div>
            ))}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Tasas y avales
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {formatEur(b.totalCost)}
              </p>
              <p className="mt-1 text-[11px] text-gray-500">
                Se presupuestan; no son un extra imprevisto
              </p>
            </div>
          </div>

          {b.warnings.length > 0 && (
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
                <IconAlertTriangle size={16} />
                Atención
              </p>
              <ul className="space-y-1.5">
                {b.warnings.map((w) => (
                  <li key={w} className="text-sm text-amber-800">
                    · {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {b.permits.length === 0 ? (
            <EmptyState
              icon={<IconCalendar size={26} />}
              title="Esta obra no tiene trámites registrados"
            >
              <p className="mx-auto max-w-md text-sm text-gray-500">
                Los expedientes de acometida deberían abrirse el mismo mes de la
                adjudicación, no cuando hacen falta.
              </p>
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                    <th className="px-4 py-3 font-medium">Trámite</th>
                    <th className="px-4 py-3 font-medium">Interlocutor</th>
                    <th className="px-4 py-3 font-medium">Solicitado</th>
                    <th className="px-4 py-3 font-medium">Comprometido</th>
                    <th className="px-4 py-3 text-right font-medium">
                      Retraso
                    </th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {b.permits.map((p) => (
                    <tr
                      key={p.id}
                      className={`border-b border-gray-100 last:border-0 ${LIGHT_ROW[p.light]}`}
                    >
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2 font-medium">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${LIGHT_DOT[p.light]}`}
                          />
                          {PERMIT_KIND_LABELS[p.kind]}
                          {p.blocking && (
                            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                              BLOQUEA INICIO
                            </span>
                          )}
                        </span>
                        {p.reasons.map((r) => (
                          <span
                            key={r}
                            className="mt-1 block pl-4 text-[11px] text-amber-800"
                          >
                            {r}
                          </span>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {p.counterparty ?? '—'}
                        {p.reference && (
                          <span className="block font-mono text-[11px] text-gray-400">
                            {p.reference}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {p.requestedAt ? formatDate(p.requestedAt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {p.committedAt ? formatDate(p.committedAt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {p.daysLate > 0 ? (
                          <span className="font-semibold text-red-600">
                            +{p.daysLate} d
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {PERMIT_STATUS_LABELS[p.status]}
                        {p.grantedAt && (
                          <span className="block text-[11px] text-emerald-700">
                            {formatDate(p.grantedAt)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          className="text-xs text-gray-500 hover:text-gray-900"
                          onClick={() => openEdit(p)}
                        >
                          Editar
                        </button>
                        {p.status === 'en_tramite' && (
                          <button
                            className="ml-3 text-xs text-gray-500 hover:text-emerald-700"
                            onClick={() => grant.mutate(p)}
                          >
                            Conceder
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-4 text-xs text-gray-500">
            El semáforo mira dos cosas distintas: los días de retraso sobre la
            fecha que comprometió el organismo, y si un trámite todavía sin
            pedir llega a tiempo dado su plazo de tramitación habitual. Lo
            segundo avisa mucho antes.
          </p>
        </>
      )}

      <Modal
        open={creating}
        title={editing ? PERMIT_KIND_LABELS[editing.kind] : 'Nuevo trámite'}
        onClose={() => setCreating(false)}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div>
            <label className={labelCls}>Trámite</label>
            <select
              className={selectCls}
              value={form.kind}
              onChange={(e) => {
                const kind = e.target.value as PermitKind;
                setForm({
                  ...form,
                  kind,
                  // El interlocutor habitual se propone solo
                  counterparty:
                    form.counterparty || PERMIT_COUNTERPARTIES[kind],
                });
              }}
            >
              {PERMIT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PERMIT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Plazo de tramitación de referencia: unos {leadMonths(form.kind)}{' '}
              meses.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Interlocutor</label>
              <input
                className={fieldCls}
                value={form.counterparty}
                onChange={(e) =>
                  setForm({ ...form, counterparty: e.target.value })
                }
              />
            </div>
            <div>
              <label className={labelCls}>Nº de expediente</label>
              <input
                className={fieldCls}
                value={form.reference}
                onChange={(e) =>
                  setForm({ ...form, reference: e.target.value })
                }
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={labelCls}>Solicitado el</label>
              <input
                type="date"
                className={fieldCls}
                value={form.requestedAt}
                onChange={(e) =>
                  setForm({ ...form, requestedAt: e.target.value })
                }
              />
            </div>
            <div>
              <label className={labelCls}>Fecha comprometida</label>
              <input
                type="date"
                className={fieldCls}
                value={form.committedAt}
                onChange={(e) =>
                  setForm({ ...form, committedAt: e.target.value })
                }
              />
            </div>
            <div>
              <label className={labelCls}>Concedido el</label>
              <input
                type="date"
                className={fieldCls}
                value={form.grantedAt}
                onChange={(e) =>
                  setForm({ ...form, grantedAt: e.target.value })
                }
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Hace falta antes de</label>
              <input
                type="date"
                className={fieldCls}
                value={form.neededBy}
                onChange={(e) => setForm({ ...form, neededBy: e.target.value })}
              />
              <p className="mt-1 text-xs text-gray-500">
                Si se deja vacío se usa el fin previsto de la obra.
              </p>
            </div>
            <div>
              <label className={labelCls}>Tasas y avales (€)</label>
              <input
                className={fieldCls}
                inputMode="decimal"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={form.notApplicable}
              onChange={(e) =>
                setForm({ ...form, notApplicable: e.target.checked })
              }
            />
            No aplica en esta obra (lo tramita el promotor o no procede)
          </label>

          <div>
            <label className={labelCls}>Observaciones</label>
            <textarea
              className={fieldCls}
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

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
              disabled={save.isPending}
            >
              {save.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

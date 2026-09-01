'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { CertificationDto, PhaseDto } from '@erp/shared';
import {
  ApiError,
  certificationsApi,
  contactsApi,
  formatDate,
  formatEur,
  phasesApi,
  projectsApi,
} from '@/lib/api';
import { StatusBadge } from '@/components/status-badge';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import {
  IconPencil,
  IconPlus,
  IconReceipt,
  IconTrash,
} from '@/components/icons';
import {
  ErrorBanner,
  Modal,
  btnPrimaryCls,
  fieldCls,
  labelCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

/* ───────────────────────── Partidas ───────────────────────── */

function PhaseModal({
  open,
  phase,
  saving,
  error,
  onSave,
  onClose,
}: {
  open: boolean;
  phase: PhaseDto | null;
  saving: boolean;
  error: Error | null;
  onSave: (v: {
    code: string;
    name: string;
    budgetAmount: number | null;
  }) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');

  useEffect(() => {
    if (!open) return;
    setCode(phase?.code ?? '');
    setName(phase?.name ?? '');
    setBudget(phase?.budgetAmount?.toString() ?? '');
  }, [open, phase]);

  return (
    <Modal
      open={open}
      title={phase ? 'Editar partida' : 'Nueva partida'}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            code,
            name,
            budgetAmount:
              budget === '' ? null : Number(budget.replace(',', '.')),
          });
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Código *</label>
            <input
              className={fieldCls}
              placeholder="01.02"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Nombre *</label>
            <input
              className={fieldCls}
              placeholder="Estructura y cimentación"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Presupuesto teórico (€, sin IVA)</label>
          <input
            className={fieldCls}
            inputMode="decimal"
            placeholder="45000"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </div>
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error.message}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button type="submit" disabled={saving} className={btnPrimaryCls}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ─────────────────────── Certificaciones ─────────────────────── */

function NewCertModal({
  open,
  contractAmount,
  defaultRetention,
  prevPct,
  prevCumulative,
  saving,
  error,
  onSave,
  onClose,
}: {
  open: boolean;
  contractAmount: number | null;
  defaultRetention: number;
  prevPct: number;
  prevCumulative: number;
  saving: boolean;
  error: Error | null;
  onSave: (v: {
    certDate: string;
    cumulativePct: number;
    retentionPct: number | null;
    notes: string | null;
  }) => void;
  onClose: () => void;
}) {
  const [certDate, setCertDate] = useState('');
  const [pct, setPct] = useState('');
  const [retention, setRetention] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    setCertDate(new Date().toISOString().slice(0, 10));
    setPct('');
    setRetention(defaultRetention.toString());
    setNotes('');
  }, [open, defaultRetention]);

  const pctNum = Number(pct.replace(',', '.'));
  const preview =
    contractAmount !== null && pct !== '' && !Number.isNaN(pctNum)
      ? (contractAmount * pctNum) / 100 - prevCumulative
      : null;

  return (
    <Modal open={open} title="Nueva certificación a origen" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            certDate,
            cumulativePct: pctNum,
            retentionPct:
              retention === '' ? null : Number(retention.replace(',', '.')),
            notes: notes || null,
          });
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Fecha *</label>
            <input
              type="date"
              className={fieldCls}
              value={certDate}
              onChange={(e) => setCertDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className={labelCls}>% ejecutado a origen *</label>
            <input
              className={fieldCls}
              inputMode="decimal"
              placeholder={`> ${prevPct}`}
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              required
            />
          </div>
          <div>
            <label className={labelCls}>Retención de garantía (%)</label>
            <input
              className={fieldCls}
              inputMode="decimal"
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Notas</label>
          <textarea
            rows={2}
            className={fieldCls}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Ya certificado: {prevPct.toFixed(2)} % · {formatEur(prevCumulative)}.
          {preview !== null && (
            <span className="mt-0.5 block font-medium text-gray-800">
              Importe de este periodo:{' '}
              {formatEur(Math.round(preview * 100) / 100)}
            </span>
          )}
        </div>
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error.message}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button type="submit" disabled={saving} className={btnPrimaryCls}>
            {saving ? 'Creando…' : 'Crear certificación'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function InvoiceCertModal({
  open,
  cert,
  saving,
  error,
  onSave,
  onClose,
}: {
  open: boolean;
  cert: CertificationDto | null;
  saving: boolean;
  error: Error | null;
  onSave: (v: {
    contactId: string;
    invoiceNumber: string;
    issueDate: string;
    dueDate: string | null;
    isp: boolean;
    retentionReleaseDate: string | null;
  }) => void;
  onClose: () => void;
}) {
  const [contactId, setContactId] = useState('');
  const [number, setNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isp, setIsp] = useState(true);
  const [releaseDate, setReleaseDate] = useState('');

  const clientsQuery = useQuery({
    queryKey: ['contacts', '', ''],
    queryFn: () => contactsApi.list('', ''),
    enabled: open,
  });
  const clients = (clientsQuery.data ?? []).filter(
    (c) => c.kind === 'cliente' || c.kind === 'ambos',
  );

  useEffect(() => {
    if (!open) return;
    setContactId('');
    setNumber('');
    setIssueDate(new Date().toISOString().slice(0, 10));
    setDueDate('');
    setIsp(true);
    setReleaseDate('');
  }, [open]);

  return (
    <Modal
      open={open}
      title={`Facturar certificación nº ${cert?.seq ?? ''}`}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            contactId,
            invoiceNumber: number,
            issueDate,
            dueDate: dueDate || null,
            isp,
            retentionReleaseDate: releaseDate || null,
          });
        }}
      >
        <div>
          <label className={labelCls}>Cliente *</label>
          <select
            className={fieldCls}
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            required
          >
            <option value="">Selecciona un cliente…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Nº factura *</label>
            <input
              className={fieldCls}
              placeholder="FV-2026-001"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              required
            />
          </div>
          <div>
            <label className={labelCls}>Fecha emisión *</label>
            <input
              type="date"
              className={fieldCls}
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className={labelCls}>Vencimiento</label>
            <input
              type="date"
              className={fieldCls}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={isp}
              onChange={(e) => setIsp(e.target.checked)}
              className="h-4 w-4 accent-amber-500"
            />
            <span>
              Inversión del sujeto pasivo (ISP)
              <span className="block text-xs text-gray-500">
                IVA 0 % + leyenda legal en la factura
              </span>
            </span>
          </label>
          <div>
            <label className={labelCls}>Liberación de la garantía</label>
            <input
              type="date"
              className={fieldCls}
              value={releaseDate}
              onChange={(e) => setReleaseDate(e.target.value)}
            />
            <p className="mt-1 text-xs text-gray-500">
              Si se deja vacío: 1 año desde la emisión
            </p>
          </div>
        </div>
        {cert && (
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            Base del periodo: {formatEur(cert.periodAmount)} · Retención{' '}
            {cert.retentionPct} %: {formatEur(cert.retentionAmount)}
          </div>
        )}
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error.message}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button type="submit" disabled={saving} className={btnPrimaryCls}>
            {saving ? 'Emitiendo…' : 'Emitir factura'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ───────────────────────── Página ───────────────────────── */

export default function ObraDetallePage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();

  const projectQuery = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id),
  });
  const phasesQuery = useQuery({
    queryKey: ['phases', id],
    queryFn: () => phasesApi.list(id),
  });
  const deviationQuery = useQuery({
    queryKey: ['deviation', id],
    queryFn: () => phasesApi.deviation(id),
  });
  const certsQuery = useQuery({
    queryKey: ['certifications', id],
    queryFn: () => certificationsApi.list(id),
  });

  const [phaseModalOpen, setPhaseModalOpen] = useState(false);
  const [editingPhase, setEditingPhase] = useState<PhaseDto | null>(null);
  const [deletePhase, setDeletePhase] = useState<PhaseDto | null>(null);
  const [certModalOpen, setCertModalOpen] = useState(false);
  const [invoicingCert, setInvoicingCert] = useState<CertificationDto | null>(
    null,
  );
  const [deleteCert, setDeleteCert] = useState<CertificationDto | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['phases', id] });
    qc.invalidateQueries({ queryKey: ['deviation', id] });
    qc.invalidateQueries({ queryKey: ['certifications', id] });
  };

  const savePhase = useMutation({
    mutationFn: (v: {
      code: string;
      name: string;
      budgetAmount: number | null;
    }) =>
      editingPhase
        ? phasesApi.update(editingPhase.id, v)
        : phasesApi.create(id, v),
    onSuccess: () => {
      toast(editingPhase ? 'Partida actualizada' : 'Partida creada');
      invalidate();
      setPhaseModalOpen(false);
      setEditingPhase(null);
    },
  });

  const removePhase = useMutation({
    mutationFn: (phaseId: string) => phasesApi.remove(phaseId),
    onSuccess: () => {
      toast('Partida eliminada');
      invalidate();
      setDeletePhase(null);
    },
    onError: (e) => {
      toast(errText(e), 'error');
      setDeletePhase(null);
    },
  });

  const createCert = useMutation({
    mutationFn: (v: {
      certDate: string;
      cumulativePct: number;
      retentionPct: number | null;
      notes: string | null;
    }) => certificationsApi.create({ projectId: id, ...v }),
    onSuccess: () => {
      toast('Certificación creada');
      invalidate();
      setCertModalOpen(false);
    },
  });

  const invoiceCert = useMutation({
    mutationFn: (v: {
      contactId: string;
      invoiceNumber: string;
      issueDate: string;
      dueDate: string | null;
      isp: boolean;
      retentionReleaseDate: string | null;
    }) => certificationsApi.invoice(invoicingCert!.id, v),
    onSuccess: () => {
      toast('Factura emitida y aprobada desde la certificación');
      invalidate();
      setInvoicingCert(null);
    },
  });

  const removeCert = useMutation({
    mutationFn: (certId: string) => certificationsApi.remove(certId),
    onSuccess: () => {
      toast('Certificación eliminada');
      invalidate();
      setDeleteCert(null);
    },
    onError: (e) => {
      toast(errText(e), 'error');
      setDeleteCert(null);
    },
  });

  const project = projectQuery.data;
  const phases = phasesQuery.data ?? [];
  const deviation = deviationQuery.data;
  const certs = certsQuery.data ?? [];
  const lastCert = certs.length > 0 ? certs[certs.length - 1] : null;

  if (projectQuery.isError) {
    return <ErrorBanner message={errText(projectQuery.error)} />;
  }
  if (!project) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-64" />
        <div className="skeleton h-40 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up space-y-8">
      {/* Cabecera */}
      <div>
        <Link
          href="/obras"
          className="text-xs font-medium text-gray-500 hover:text-amber-600"
        >
          ← Obras
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          <StatusBadge status={project.status} />
        </div>
        <p className="mt-1 text-sm text-gray-500">
          <span className="font-mono">{project.code}</span>
          {' · '}Contrato: {formatEur(project.contractAmount)} sin IVA
          {' · '}Retención de garantía: {project.retentionPct} %
          {project.startDate && ` · Inicio: ${formatDate(project.startDate)}`}
        </p>
      </div>

      {/* Partidas y desvío */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Partidas y desvío presupuestario
          </h2>
          <button
            onClick={() => {
              setEditingPhase(null);
              savePhase.reset();
              setPhaseModalOpen(true);
            }}
            className={btnPrimaryCls}
          >
            <IconPlus size={14} />
            Nueva partida
          </button>
        </div>

        {phases.length === 0 && !deviation?.rows.length ? (
          <p className="py-6 text-center text-sm text-gray-500">
            Sin partidas: crea las fases de ejecución para controlar el
            presupuesto teórico frente al gasto real.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase">
                  <th className="px-3 py-2 font-medium">Partida</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Presupuesto
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Gasto imputado
                  </th>
                  <th className="w-48 px-3 py-2 font-medium">Consumo</th>
                  <th className="px-3 py-2 text-right font-medium">Desvío</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {(deviation?.rows ?? []).map((row) => {
                  const ratio =
                    row.budget > 0 ? Math.min(row.actual / row.budget, 1) : 0;
                  const over = row.deviation > 0;
                  const phase = phases.find((p) => p.id === row.phaseId);
                  return (
                    <tr
                      key={row.phaseId ?? 'sin-partida'}
                      className="border-b border-gray-100 last:border-0"
                    >
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs text-gray-500">
                          {row.code}
                        </span>{' '}
                        <span className="font-medium">{row.name}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatEur(row.budget)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatEur(row.actual)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className={
                              over
                                ? 'h-full bg-red-500'
                                : 'h-full bg-emerald-500'
                            }
                            style={{ width: `${Math.round(ratio * 100)}%` }}
                          />
                        </div>
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-medium tabular-nums ${
                          over ? 'text-red-600' : 'text-emerald-600'
                        }`}
                      >
                        {row.deviation > 0 ? '+' : ''}
                        {formatEur(row.deviation)}
                        {row.deviationPct !== null && (
                          <span className="block text-xs font-normal text-gray-400">
                            {row.deviationPct > 0 ? '+' : ''}
                            {row.deviationPct} %
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {phase && (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => {
                                setEditingPhase(phase);
                                savePhase.reset();
                                setPhaseModalOpen(true);
                              }}
                              title="Editar"
                              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                            >
                              <IconPencil size={14} />
                            </button>
                            <button
                              onClick={() => setDeletePhase(phase)}
                              title="Eliminar"
                              className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <IconTrash size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {deviation && (
                <tfoot>
                  <tr className="border-t border-gray-200 font-semibold">
                    <td className="px-3 py-2.5">Total</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatEur(deviation.budgetTotal)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatEur(deviation.actualTotal)}
                    </td>
                    <td />
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums ${
                        deviation.deviation > 0
                          ? 'text-red-600'
                          : 'text-emerald-600'
                      }`}
                    >
                      {deviation.deviation > 0 ? '+' : ''}
                      {formatEur(deviation.deviation)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </section>

      {/* Certificaciones */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Certificaciones (facturación a origen)
          </h2>
          <button
            onClick={() => {
              createCert.reset();
              setCertModalOpen(true);
            }}
            className={btnPrimaryCls}
          >
            <IconPlus size={14} />
            Nueva certificación
          </button>
        </div>

        {certs.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            Sin certificaciones todavía. La primera parte del 0 % ejecutado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase">
                  <th className="px-3 py-2 font-medium">Nº</th>
                  <th className="px-3 py-2 font-medium">Fecha</th>
                  <th className="px-3 py-2 text-right font-medium">
                    % a origen
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Acumulado
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Periodo</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Retención
                  </th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {certs.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-gray-100 last:border-0"
                  >
                    <td className="px-3 py-2.5 font-medium">{c.seq}</td>
                    <td className="px-3 py-2.5 text-gray-600">
                      {formatDate(c.certDate)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {c.cumulativePct} %
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatEur(c.cumulativeAmount)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                      {formatEur(c.periodAmount)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-600 tabular-nums">
                      {formatEur(c.retentionAmount)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          c.status === 'facturada'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                        {c.status === 'facturada' ? 'Facturada' : 'Borrador'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        {c.status === 'borrador' && (
                          <>
                            <button
                              onClick={() => {
                                invoiceCert.reset();
                                setInvoicingCert(c);
                              }}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50"
                            >
                              <IconReceipt size={13} />
                              Facturar
                            </button>
                            <button
                              onClick={() => setDeleteCert(c)}
                              title="Eliminar"
                              className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <IconTrash size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modales */}
      <PhaseModal
        open={phaseModalOpen}
        phase={editingPhase}
        saving={savePhase.isPending}
        error={(savePhase.error as ApiError | null) ?? null}
        onSave={(v) => savePhase.mutate(v)}
        onClose={() => {
          setPhaseModalOpen(false);
          setEditingPhase(null);
        }}
      />
      <NewCertModal
        open={certModalOpen}
        contractAmount={project.contractAmount}
        defaultRetention={project.retentionPct}
        prevPct={lastCert ? lastCert.cumulativePct : 0}
        prevCumulative={lastCert ? lastCert.cumulativeAmount : 0}
        saving={createCert.isPending}
        error={(createCert.error as ApiError | null) ?? null}
        onSave={(v) => createCert.mutate(v)}
        onClose={() => setCertModalOpen(false)}
      />
      <InvoiceCertModal
        open={invoicingCert !== null}
        cert={invoicingCert}
        saving={invoiceCert.isPending}
        error={(invoiceCert.error as ApiError | null) ?? null}
        onSave={(v) => invoiceCert.mutate(v)}
        onClose={() => setInvoicingCert(null)}
      />
      <ConfirmDialog
        open={deletePhase !== null}
        title={`¿Eliminar la partida "${deletePhase?.name ?? ''}"?`}
        description="Las líneas de factura ya imputadas quedarán como gasto sin partida."
        loading={removePhase.isPending}
        onConfirm={() => deletePhase && removePhase.mutate(deletePhase.id)}
        onCancel={() => setDeletePhase(null)}
      />
      <ConfirmDialog
        open={deleteCert !== null}
        title={`¿Eliminar la certificación nº ${deleteCert?.seq ?? ''}?`}
        description="Solo se puede eliminar la última certificación y en borrador."
        loading={removeCert.isPending}
        onConfirm={() => deleteCert && removeCert.mutate(deleteCert.id)}
        onCancel={() => setDeleteCert(null)}
      />
    </div>
  );
}

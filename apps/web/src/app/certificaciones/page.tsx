'use client';

/**
 * Página /certificaciones
 *
 * Historial de certificaciones a origen por obra.
 * Flujo: selector de obra → tabla de certifcaciones → nueva cert → facturar
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CERT_STATUS_LABELS,
  type CertStatus,
  type CertificationDto,
  type CertificationCreateInput,
  type CertificationInvoiceInput,
  type CertificationLineDto,
  type CertificationLineCreateInput,
} from '@erp/shared';
import {
  ApiError,
  certificationsApi,
  certificationLinesApi,
  contactsApi,
  formatDate,
  formatEur,
  projectsApi,
} from '@/lib/api';
import { useToast } from '@/components/toast';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  IconChevronDown,
  IconChevronUp,
  IconClipboard,
  IconPlus,
  IconReceipt,
  IconTrash,
} from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  Modal,
  PageHeader,
  TableSkeleton,
  btnGhostCls,
  btnPrimaryCls,
  fieldCls,
  inputCls,
  labelCls,
  selectCls,
} from '@/components/ui';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const errText = (e: unknown) =>
  e instanceof ApiError ? e.message : (e as Error).message ?? 'Error inesperado';

const pct = (n: number) => `${n.toFixed(2)} %`;

const STATUS_STYLES: Record<CertStatus, string> = {
  borrador: 'bg-gray-200 text-gray-600',
  facturada: 'bg-emerald-100 text-emerald-700',
};

function CertBadge({ status }: { status: CertStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {CERT_STATUS_LABELS[status]}
    </span>
  );
}

// ─── Modal nueva certificación ────────────────────────────────────────────────

interface NuevaCertModalProps {
  open: boolean;
  projectId: string;
  lastPct: number;
  onSuccess: () => void;
  onClose: () => void;
}

function NuevaCertModal({
  open,
  projectId,
  lastPct,
  onSuccess,
  onClose,
}: NuevaCertModalProps) {
  const toast = useToast();
  const [certDate, setCertDate] = useState(new Date().toISOString().slice(0, 10));
  const [cumulativePct, setCumulativePct] = useState('');
  const [retentionPct, setRetentionPct] = useState('');
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: (input: CertificationCreateInput) => certificationsApi.create(input),
    onSuccess: () => {
      toast('Certificación creada');
      setCumulativePct('');
      setRetentionPct('');
      setNotes('');
      onSuccess();
      onClose();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const pctVal = parseFloat(cumulativePct);
  const pctError =
    cumulativePct && (pctVal <= lastPct || pctVal > 100)
      ? `Debe ser mayor que ${lastPct.toFixed(2)} % y ≤ 100 %`
      : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isNaN(pctVal) || pctVal <= lastPct || pctVal > 100) return;
    mutation.mutate({
      projectId,
      certDate,
      cumulativePct: pctVal,
      retentionPct: retentionPct ? parseFloat(retentionPct) : undefined,
      notes: notes || undefined,
    });
  }

  return (
    <Modal open={open} title="Nueva certificación" onClose={onClose}>
      <form id="cert-form" onSubmit={handleSubmit} className="space-y-4">
        {lastPct > 0 && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-800">
            Último % certificado a origen:{' '}
            <span className="font-semibold">{pct(lastPct)}</span>. El nuevo debe ser mayor.
          </div>
        )}

        <div className={fieldCls}>
          <label className={labelCls}>Fecha de certificación</label>
          <input
            type="date"
            required
            value={certDate}
            onChange={(e) => setCertDate(e.target.value)}
            className={inputCls}
          />
        </div>

        <div className={fieldCls}>
          <label className={labelCls}>
            % ejecutado acumulado a origen{' '}
            <span className="font-normal text-gray-400">(total, no del periodo)</span>
          </label>
          <input
            type="number"
            step="0.01"
            min={lastPct > 0 ? lastPct + 0.01 : 0.01}
            max="100"
            required
            placeholder={`> ${lastPct.toFixed(2)}`}
            value={cumulativePct}
            onChange={(e) => setCumulativePct(e.target.value)}
            className={inputCls}
          />
          {pctError && <p className="mt-1 text-xs text-red-500">{pctError}</p>}
        </div>

        <div className={fieldCls}>
          <label className={labelCls}>
            % retención garantía{' '}
            <span className="font-normal text-gray-400">(vacío = usa el de la obra)</span>
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            max="20"
            placeholder="5.00"
            value={retentionPct}
            onChange={(e) => setRetentionPct(e.target.value)}
            className={inputCls}
          />
        </div>

        <div className={fieldCls}>
          <label className={labelCls}>Notas</label>
          <textarea
            rows={2}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputCls}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={btnGhostCls}>
            Cancelar
          </button>
          <button type="submit" disabled={mutation.isPending} className={btnPrimaryCls}>
            {mutation.isPending ? 'Guardando…' : 'Crear certificación'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Modal facturar ───────────────────────────────────────────────────────────

interface FacturarModalProps {
  open: boolean;
  cert: CertificationDto | null;
  contacts: Array<{ id: string; legalName: string }>;
  onSuccess: () => void;
  onClose: () => void;
}

function FacturarModal({ open, cert, contacts, onSuccess, onClose }: FacturarModalProps) {
  const toast = useToast();
  const [contactId, setContactId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [isp, setIsp] = useState(true);
  const [retentionReleaseDate, setRetentionReleaseDate] = useState('');

  const mutation = useMutation({
    mutationFn: (input: CertificationInvoiceInput) =>
      certificationsApi.invoice(cert!.id, input),
    onSuccess: () => {
      toast('Factura de venta generada');
      setContactId('');
      setInvoiceNumber('');
      onSuccess();
      onClose();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  if (!cert) return null;

  const neto = cert.periodAmount - cert.retentionAmount;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate({
      contactId,
      invoiceNumber,
      issueDate,
      dueDate: dueDate || undefined,
      isp,
      retentionReleaseDate: retentionReleaseDate || undefined,
    });
  }

  return (
    <Modal open={open} title={`Facturar Cert. nº ${cert.seq}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Resumen de importes */}
        <div className="grid grid-cols-3 gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
          <div>
            <p className="text-gray-500">Importe periodo</p>
            <p className="font-semibold">{formatEur(cert.periodAmount)}</p>
          </div>
          <div>
            <p className="text-gray-500">Retención</p>
            <p className="font-semibold text-amber-600">− {formatEur(cert.retentionAmount)}</p>
          </div>
          <div>
            <p className="text-gray-500">Neto</p>
            <p className="font-semibold text-emerald-600">{formatEur(neto)}</p>
          </div>
        </div>

        <div className={fieldCls}>
          <label className={labelCls}>Cliente *</label>
          <select
            required
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className={selectCls}
          >
            <option value="">Selecciona un cliente…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className={fieldCls}>
            <label className={labelCls}>Nº factura *</label>
            <input
              required
              maxLength={60}
              placeholder="VTA-2026-001"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Fecha emisión *</label>
            <input
              type="date"
              required
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className={fieldCls}>
            <label className={labelCls}>Vencimiento</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Libera retención el</label>
            <input
              type="date"
              value={retentionReleaseDate}
              onChange={(e) => setRetentionReleaseDate(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50">
          <input
            type="checkbox"
            checked={isp}
            onChange={(e) => setIsp(e.target.checked)}
            className="h-4 w-4 rounded accent-amber-500"
          />
          <span className="text-sm text-gray-700">
            Inversión del sujeto pasivo (ISP)
            <span className="ml-1.5 text-gray-400 text-xs">— habitual en construcción B2B</span>
          </span>
        </label>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={btnGhostCls}>
            Cancelar
          </button>
          <button type="submit" disabled={mutation.isPending} className={btnPrimaryCls}>
            {mutation.isPending ? 'Generando…' : 'Emitir factura'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Modal nueva línea ────────────────────────────────────────────────────────

interface NuevaLineaModalProps {
  open: boolean;
  certId: string;
  onSuccess: () => void;
  onClose: () => void;
}

function NuevaLineaModal({ open, certId, onSuccess, onClose }: NuevaLineaModalProps) {
  const toast = useToast();
  const [budgetItemId, setBudgetItemId] = useState('');
  const [cumulativePct, setCumulativePct] = useState('');
  const [cumulativeAmount, setCumulativeAmount] = useState('');
  const [periodAmount, setPeriodAmount] = useState('');
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: (input: CertificationLineCreateInput) =>
      certificationLinesApi.create(certId, input),
    onSuccess: () => {
      toast('Línea añadida');
      setBudgetItemId('');
      setCumulativePct('');
      setCumulativeAmount('');
      setPeriodAmount('');
      setNotes('');
      onSuccess();
      onClose();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate({
      budgetItemId,
      cumulativePct: parseFloat(cumulativePct),
      cumulativeAmount: parseFloat(cumulativeAmount),
      periodAmount: parseFloat(periodAmount),
      notes: notes || undefined,
    });
  }

  return (
    <Modal open={open} title="Añadir línea de certificación" onClose={onClose}>
      <form id="line-form" onSubmit={handleSubmit} className="space-y-4">
        <div className={fieldCls}>
          <label className={labelCls}>ID de partida presupuestaria</label>
          <input
            type="text"
            required
            placeholder="UUID de la partida"
            value={budgetItemId}
            onChange={(e) => setBudgetItemId(e.target.value)}
            className={inputCls}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className={fieldCls}>
            <label className={labelCls}>% Acumulado</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              required
              value={cumulativePct}
              onChange={(e) => setCumulativePct(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Importe acum. (€)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              value={cumulativeAmount}
              onChange={(e) => setCumulativeAmount(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Importe periodo (€)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              value={periodAmount}
              onChange={(e) => setPeriodAmount(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Notas (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputCls}
            maxLength={500}
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnGhostCls}>
            Cancelar
          </button>
          <button type="submit" form="line-form" className={btnPrimaryCls} disabled={mutation.isPending}>
            {mutation.isPending ? 'Guardando…' : 'Añadir línea'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Panel de líneas ──────────────────────────────────────────────────────────

function LinesPanel({ certId }: { certId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const linesQuery = useQuery({
    queryKey: ['cert-lines', certId],
    queryFn: () => certificationLinesApi.list(certId),
  });

  const removeLine = useMutation({
    mutationFn: (lineId: string) => certificationLinesApi.remove(certId, lineId),
    onSuccess: () => {
      toast('Línea eliminada');
      qc.invalidateQueries({ queryKey: ['cert-lines', certId] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const lines: CertificationLineDto[] = linesQuery.data ?? [];

  return (
    <div className="border-t border-gray-100 bg-gray-50/60 px-6 py-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Líneas de certificación ({lines.length})
        </p>
        <button
          onClick={() => setAddOpen(true)}
          className={btnGhostCls + ' gap-1 text-xs'}
        >
          <IconPlus size={12} />
          Añadir línea
        </button>
      </div>

      {linesQuery.isLoading && (
        <p className="text-xs text-gray-400">Cargando líneas…</p>
      )}

      {lines.length === 0 && !linesQuery.isLoading && (
        <p className="text-xs text-gray-400">Sin líneas. Añade partidas para desglosar la certificación.</p>
      )}

      {lines.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left font-semibold text-gray-500">
              <th className="pb-1 pr-4">Partida ID</th>
              <th className="pb-1 pr-4 text-right">% Acum.</th>
              <th className="pb-1 pr-4 text-right">Importe periodo</th>
              <th className="pb-1 pr-4 text-right">Importe acum.</th>
              <th className="pb-1" />
            </tr>
          </thead>
          <tbody>
            {lines.map((ln) => (
              <tr key={ln.id} className="border-t border-gray-100">
                <td className="py-1 pr-4 font-mono text-gray-600">{ln.budgetItemId.slice(0, 8)}…</td>
                <td className="py-1 pr-4 text-right font-mono">{ln.cumulativePct.toFixed(2)} %</td>
                <td className="py-1 pr-4 text-right font-mono">{formatEur(ln.periodAmount)}</td>
                <td className="py-1 pr-4 text-right font-mono">{formatEur(ln.cumulativeAmount)}</td>
                <td className="py-1">
                  <button
                    onClick={() => removeLine.mutate(ln.id)}
                    className="rounded p-0.5 text-gray-300 hover:text-red-500"
                    title="Eliminar línea"
                  >
                    <IconTrash size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <NuevaLineaModal
        open={addOpen}
        certId={certId}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['cert-lines', certId] })}
        onClose={() => setAddOpen(false)}
      />
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent = 'text-gray-900',
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

// ─── Tabla de certificaciones ──────────────────────────────────────────────────

interface CertTableProps {
  certs: CertificationDto[];
  contacts: Array<{ id: string; legalName: string }>;
  onFacturar: (c: CertificationDto) => void;
  onDelete: (c: CertificationDto) => void;
}

function CertTable({ certs, contacts, onFacturar, onDelete }: CertTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-500">
            <th className="px-4 py-3 text-center">Nº</th>
            <th className="px-4 py-3">Fecha</th>
            <th className="px-4 py-3 text-right">% Acumulado</th>
            <th className="px-4 py-3 text-right">Importe periodo</th>
            <th className="px-4 py-3 text-right">Retención</th>
            <th className="px-4 py-3 text-right">Neto</th>
            <th className="px-4 py-3">Estado</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {certs.map((cert) => (
            <>
            <tr key={cert.id} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="px-4 py-3 text-center font-semibold text-amber-600">
                {cert.seq}
              </td>
              <td className="px-4 py-3 text-gray-600">{formatDate(cert.certDate)}</td>
              <td className="px-4 py-3 text-right font-mono font-medium">
                {pct(cert.cumulativePct)}
              </td>
              <td className="px-4 py-3 text-right font-mono">
                <div>{formatEur(cert.periodAmount)}</div>
                <div className="text-xs text-gray-400">
                  acum. {formatEur(cert.cumulativeAmount)}
                </div>
              </td>
              <td className="px-4 py-3 text-right font-mono text-amber-600">
                {formatEur(cert.retentionAmount)}
                <div className="text-xs text-gray-400">{cert.retentionPct.toFixed(1)} %</div>
              </td>
              <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-600">
                {formatEur(cert.periodAmount - cert.retentionAmount)}
              </td>
              <td className="px-4 py-3">
                <CertBadge status={cert.status} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setExpandedId(expandedId === cert.id ? null : cert.id)}
                    className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    title="Ver líneas"
                  >
                    {expandedId === cert.id ? (
                      <IconChevronUp size={14} />
                    ) : (
                      <IconChevronDown size={14} />
                    )}
                  </button>
                  {cert.status === 'borrador' && (
                    <button
                      onClick={() => onFacturar(cert)}
                      className={btnGhostCls + ' gap-1.5 text-xs'}
                    >
                      <IconReceipt size={14} />
                      Facturar
                    </button>
                  )}
                  {cert.status === 'borrador' && (
                    <button
                      onClick={() => onDelete(cert)}
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                      title="Eliminar"
                    >
                      <IconTrash size={14} />
                    </button>
                  )}
                </div>
              </td>
            </tr>
            {expandedId === cert.id && (
              <tr key={`${cert.id}-lines`}>
                <td colSpan={8} className="p-0">
                  <LinesPanel certId={cert.id} />
                </td>
              </tr>
            )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function CertificacionesPage() {
  const qc = useQueryClient();
  const toast = useToast();

  const [projectId, setProjectId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [facturarTarget, setFacturarTarget] = useState<CertificationDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CertificationDto | null>(null);

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
  });

  const certsQuery = useQuery({
    queryKey: ['certifications', projectId],
    queryFn: () => certificationsApi.list(projectId),
    enabled: !!projectId,
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', '', 'cliente'],
    queryFn: () => contactsApi.list('', 'cliente'),
    staleTime: 5 * 60_000,
    enabled: !!facturarTarget,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['certifications', projectId] });
    qc.invalidateQueries({ queryKey: ['invoices'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => certificationsApi.remove(id),
    onSuccess: () => {
      toast('Certificación eliminada');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const certs = certsQuery.data ?? [];
  const lastCert = certs[certs.length - 1];
  const lastPct = lastCert?.cumulativePct ?? 0;
  const totalCertificado = certs.reduce((s, c) => s + c.periodAmount, 0);
  const totalRetencion = certs.reduce((s, c) => s + c.retentionAmount, 0);

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Certificaciones" subtitle="Avance a origen por obra con facturación automática">
        {projectId && (
          <button onClick={() => setCreateOpen(true)} className={btnPrimaryCls + ' gap-1.5'}>
            <IconPlus size={16} />
            Nueva certificación
          </button>
        )}
      </PageHeader>

      {/* Selector de obra */}
      <div className="max-w-sm">
        <label className="mb-1.5 block text-sm font-medium text-gray-700">Obra</label>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className={selectCls}
        >
          <option value="">Selecciona una obra…</option>
          {projectsQuery.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Sin obra seleccionada */}
      {!projectId && (
        <EmptyState icon={<IconClipboard size={40} />} title="Selecciona una obra">
          <p className="text-sm text-gray-500">
            Elige una obra para ver y gestionar sus certificaciones
          </p>
        </EmptyState>
      )}

      {/* Con obra */}
      {projectId && (
        <>
          {/* KPIs (solo si hay certs) */}
          {certs.length > 0 && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <KpiCard
                label="Neto certificado"
                value={formatEur(totalCertificado - totalRetencion)}
                sub="sin retención"
                accent="text-emerald-600"
              />
              <KpiCard
                label="Retención acumulada"
                value={formatEur(totalRetencion)}
                sub="pendiente de liberar"
                accent="text-amber-600"
              />
              <KpiCard
                label="% ejecutado"
                value={pct(lastPct)}
                sub={`Cert. nº ${lastCert?.seq ?? 0}`}
              />
              <KpiCard
                label="Certificaciones"
                value={String(certs.length)}
                sub={`${certs.filter((c) => c.status === 'facturada').length} facturadas`}
              />
            </div>
          )}

          {certsQuery.isLoading && <TableSkeleton rows={4} />}
          {certsQuery.error && <ErrorBanner message={errText(certsQuery.error)} />}

          {!certsQuery.isLoading && !certsQuery.error && certs.length === 0 && (
            <EmptyState icon={<IconClipboard size={40} />} title="Sin certificaciones">
              <p className="text-sm text-gray-500">
                Crea la primera certificación para registrar el avance de la obra
              </p>
            </EmptyState>
          )}

          {certs.length > 0 && (
            <CertTable
              certs={certs}
              contacts={contactsQuery.data ?? []}
              onFacturar={setFacturarTarget}
              onDelete={setDeleteTarget}
            />
          )}
        </>
      )}

      {/* Modales */}
      <NuevaCertModal
        open={createOpen}
        projectId={projectId}
        lastPct={lastPct}
        onSuccess={invalidate}
        onClose={() => setCreateOpen(false)}
      />

      <FacturarModal
        open={!!facturarTarget}
        cert={facturarTarget}
        contacts={contactsQuery.data ?? []}
        onSuccess={invalidate}
        onClose={() => setFacturarTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={`¿Eliminar certificación nº ${deleteTarget?.seq}?`}
        description="Se eliminará la certificación. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

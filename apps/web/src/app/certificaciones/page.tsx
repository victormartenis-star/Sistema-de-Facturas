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
  CERT_STATUSES,
  CERT_STATUS_LABELS,
  type CertStatus,
  type CertificationDto,
  type CertificationCreateInput,
  type CertificationInvoiceInput,
  type CertificationRectifyInput,
  FACTURAE_REASON_CODES,
  RECTIFICATION_MOTIVES,
  RECTIFICATION_MOTIVE_LABELS,
  allowedFacturaeReasonCodes,
  type RectificationMotive,
  canEditCertification,
  type CertificationLineDto,
  type CertificationLineCreateInput,
} from '@erp/shared';
import {
  ApiError,
  certificationsApi,
  certificationLinesApi,
  contactsApi,
  exportsApi,
  formatDate,
  formatEur,
} from '@/lib/api';
import { useAvisarError, useToast } from '@/components/toast';
import { useListadoPaginado } from '@/lib/use-listado-paginado';
import { usePermisos } from '@/lib/permisos';
import { useClaveIntento } from '@/lib/clave-intento';
import { etiquetaCertificacionOriginal } from '@/lib/trazabilidad';
import {
  BarraFiltros,
  DataTable,
  FiltroEstado,
  FiltroObra,
  type ColumnaDef,
} from '@/components/data-table';
import { KpiCard } from '@/components/kpi-card';
import { TrazabilidadFiscal } from '@/components/trazabilidad-fiscal';
import { Autorizado } from '@/components/autorizado';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { MOTIVO_MAX, MOTIVO_MIN } from '@/components/reason-dialog';
import {
  IconClipboard,
  IconPlus,
  IconReceipt,
  IconTrash,
} from '@/components/icons';
import {
  EmptyState,
  Modal,
  PageHeader,
  btnGhostCls,
  btnPrimaryCls,
  fieldCls,
  inputCls,
  labelCls,
  selectCls,
} from '@/components/ui';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const errText = (e: unknown) =>
  e instanceof ApiError
    ? e.message
    : ((e as Error).message ?? 'Error inesperado');

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
  const [certDate, setCertDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [cumulativePct, setCumulativePct] = useState('');
  const [retentionPct, setRetentionPct] = useState('');
  const [notes, setNotes] = useState('');
  const clave = useClaveIntento(open);

  const mutation = useMutation({
    mutationFn: (input: CertificationCreateInput) =>
      certificationsApi.create(input, clave.actual()),
    onSuccess: () => {
      clave.renovar();
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
            <span className="font-semibold">{pct(lastPct)}</span>. El nuevo debe
            ser mayor.
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
            <span className="font-normal text-gray-400">
              (total, no del periodo)
            </span>
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
            <span className="font-normal text-gray-400">
              (vacío = usa el de la obra)
            </span>
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
          <button
            type="submit"
            disabled={mutation.isPending}
            className={btnPrimaryCls}
          >
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

function FacturarModal({
  open,
  cert,
  contacts,
  onSuccess,
  onClose,
}: FacturarModalProps) {
  const toast = useToast();
  const [contactId, setContactId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [issueDate, setIssueDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
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
    <Modal
      open={open}
      title={`Facturar Cert. nº ${cert.seq}`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Resumen de importes */}
        <div className="grid grid-cols-3 gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
          <div>
            <p className="text-gray-500">Importe periodo</p>
            <p className="font-semibold">{formatEur(cert.periodAmount)}</p>
          </div>
          <div>
            <p className="text-gray-500">Retención</p>
            <p className="font-semibold text-amber-600">
              − {formatEur(cert.retentionAmount)}
            </p>
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
            <span className="ml-1.5 text-gray-400 text-xs">
              — habitual en construcción B2B
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={btnGhostCls}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className={btnPrimaryCls}
          >
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

function NuevaLineaModal({
  open,
  certId,
  onSuccess,
  onClose,
}: NuevaLineaModalProps) {
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
          <button
            type="submit"
            form="line-form"
            className={btnPrimaryCls}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Guardando…' : 'Añadir línea'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Panel de líneas ──────────────────────────────────────────────────────────

function LinesPanel({
  certId,
  editable,
}: {
  certId: string;
  editable: boolean;
}) {
  const toast = useToast();
  const avisarError = useAvisarError();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const linesQuery = useQuery({
    queryKey: ['cert-lines', certId],
    queryFn: () => certificationLinesApi.list(certId),
  });

  const removeLine = useMutation({
    mutationFn: (ln: CertificationLineDto) =>
      certificationLinesApi.remove(certId, ln.id, ln.version),
    onSuccess: () => {
      toast('Línea eliminada');
      qc.invalidateQueries({ queryKey: ['cert-lines', certId] });
    },
    onError: (e) =>
      avisarError(e, () =>
        qc.invalidateQueries({ queryKey: ['cert-lines', certId] }),
      ),
  });

  const lines: CertificationLineDto[] = linesQuery.data ?? [];

  return (
    <div className="border-t border-gray-100 bg-gray-50/60 px-6 py-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Líneas de certificación ({lines.length})
        </p>
        {editable && (
          <button
            onClick={() => setAddOpen(true)}
            className={btnGhostCls + ' gap-1 text-xs'}
          >
            <IconPlus size={12} />
            Añadir línea
          </button>
        )}
      </div>

      {linesQuery.isLoading && (
        <p className="text-xs text-gray-400">Cargando líneas…</p>
      )}

      {lines.length === 0 && !linesQuery.isLoading && (
        <p className="text-xs text-gray-400">
          Sin líneas. Añade partidas para desglosar la certificación.
        </p>
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
                <td className="py-1 pr-4 font-mono text-gray-600">
                  {ln.budgetItemId.slice(0, 8)}…
                </td>
                <td className="py-1 pr-4 text-right font-mono">
                  {ln.cumulativePct.toFixed(2)} %
                </td>
                <td className="py-1 pr-4 text-right font-mono">
                  {formatEur(ln.periodAmount)}
                </td>
                <td className="py-1 pr-4 text-right font-mono">
                  {formatEur(ln.cumulativeAmount)}
                </td>
                <td className="py-1">
                  {editable && (
                    <button
                      onClick={() => removeLine.mutate(ln)}
                      className="rounded p-0.5 text-gray-300 hover:text-red-500"
                      title="Eliminar línea"
                    >
                      <IconTrash size={12} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <NuevaLineaModal
        open={addOpen}
        certId={certId}
        onSuccess={() =>
          qc.invalidateQueries({ queryKey: ['cert-lines', certId] })
        }
        onClose={() => setAddOpen(false)}
      />
    </div>
  );
}

// ─── Modal rectificar certificación ───────────────────────────────────────────

function RectificarCertModal({
  open,
  cert,
  onSuccess,
  onClose,
}: {
  open: boolean;
  cert: CertificationDto | null;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [certDate, setCertDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [cumulativePct, setCumulativePct] = useState('');
  const [motivo, setMotivo] = useState('');
  const [rectMotive, setRectMotive] = useState<RectificationMotive>('R4');
  // Sin valor por defecto: lo elige el titular, acotado por el motivo.
  const [reasonCode, setReasonCode] = useState('');
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: (input: CertificationRectifyInput) =>
      certificationsApi.rectify(cert!.id, input),
    onSuccess: () => {
      toast('Certificación rectificativa creada en borrador');
      setCumulativePct('');
      setMotivo('');
      setReasonCode('');
      setNotes('');
      onSuccess();
      onClose();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const pctVal = parseFloat(cumulativePct);
  const pctOk = Number.isFinite(pctVal) && pctVal >= 0 && pctVal <= 100;
  const motivoOk = motivo.trim().length >= MOTIVO_MIN;
  const codigosPermitidos = allowedFacturaeReasonCodes(rectMotive);
  const codigoOk = (codigosPermitidos as string[]).includes(reasonCode);

  if (!cert) return null;

  return (
    <Modal
      open={open}
      title={`Rectificar la certificación nº ${cert.seq}`}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate({
            certDate,
            cumulativePct: pctVal,
            motivo: motivo.trim(),
            rectificationMotive: rectMotive,
            // La certificación rectificativa se factura por diferencias: tipo I.
            rectificationType: 'I',
            facturaeReasonCode: reasonCode,
            notes: notes.trim() || null,
          });
        }}
      >
        <p className="text-sm text-gray-500">
          Indica el % acumulado correcto a origen (actual:{' '}
          {cert.cumulativePct.toFixed(2)} %). Puede ser menor: el periodo sale
          negativo y, al facturarla, se genera una factura rectificativa por
          diferencias.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="rc-fecha">
              Fecha
            </label>
            <input
              id="rc-fecha"
              type="date"
              value={certDate}
              onChange={(e) => setCertDate(e.target.value)}
              className={fieldCls}
              required
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="rc-pct">
              % acumulado correcto
            </label>
            <input
              id="rc-pct"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={cumulativePct}
              onChange={(e) => setCumulativePct(e.target.value)}
              className={fieldCls}
              required
            />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="rc-motive">
            Motivo oficial
          </label>
          <select
            id="rc-motive"
            value={rectMotive}
            onChange={(e) => {
              setRectMotive(e.target.value as RectificationMotive);
              setReasonCode('');
            }}
            className={fieldCls}
          >
            {RECTIFICATION_MOTIVES.map((m) => (
              <option key={m} value={m}>
                {RECTIFICATION_MOTIVE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="rc-code">
            Código de motivo Facturae
          </label>
          <select
            id="rc-code"
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value)}
            className={fieldCls}
          >
            <option value="">Selecciona un código…</option>
            {codigosPermitidos.map((c) => (
              <option key={c} value={c}>
                {c} - {FACTURAE_REASON_CODES[c]}
              </option>
            ))}
          </select>
          {rectMotive === 'R3' && (
            <p className="mt-1 text-xs text-gray-500">
              Para R3 el código es una aproximación pendiente de confirmar.
            </p>
          )}
        </div>
        <div>
          <label className={labelCls} htmlFor="rc-motivo">
            Motivo
          </label>
          <textarea
            id="rc-motivo"
            rows={2}
            maxLength={MOTIVO_MAX}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className={fieldCls}
            placeholder={`Mínimo ${MOTIVO_MIN} caracteres`}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="rc-notas">
            Notas (opcional)
          </label>
          <input
            id="rc-notas"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={fieldCls}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhostCls}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={mutation.isPending || !pctOk || !motivoOk || !codigoOk}
            className={btnPrimaryCls + ' disabled:opacity-60'}
          >
            Crear rectificativa
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function CertificacionesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const { can } = usePermisos();

  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [facturarTarget, setFacturarTarget] = useState<CertificationDto | null>(
    null,
  );
  const [rectifyTarget, setRectifyTarget] = useState<CertificationDto | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<CertificationDto | null>(
    null,
  );

  // Tabla: paginada en servidor (la obra es obligatoria).
  const listado = useListadoPaginado({
    clave: 'certifications',
    filtrosIniciales: { projectId: '', status: '' },
    habilitada: (f) => f.projectId !== '',
    consulta: (p) => certificationsApi.listPaginado(p),
  });
  const { filtros, setFiltro } = listado;
  const projectId = filtros.projectId;

  // Lista completa de la obra (decisión D7): KPIs, `lastPct` del modal y
  // "rectifica nº" no pueden salir de la página visible.
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
    qc.invalidateQueries({ queryKey: ['certifications'] });
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: ['economics'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (c: CertificationDto) =>
      certificationsApi.remove(c.id, c.version),
    onSuccess: () => {
      toast('Certificación eliminada');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e) => {
      avisarError(e, invalidate);
      setDeleteTarget(null);
    },
  });

  const certs = certsQuery.data ?? [];
  const lastCert = certs[certs.length - 1];
  const lastPct = lastCert?.cumulativePct ?? 0;
  const totalCertificado = certs.reduce((s, c) => s + c.periodAmount, 0);
  const totalRetencion = certs.reduce((s, c) => s + c.retentionAmount, 0);

  const columnas: ColumnaDef<CertificationDto>[] = [
    {
      id: 'seq',
      cabecera: 'Nº',
      alineacion: 'centro',
      celda: (cert) => (
        <span className="font-semibold text-amber-600">
          {cert.seq}
          {cert.rectifiesCertificationId && (
            <div
              className="text-[10px] font-medium text-amber-700"
              title={cert.rectificationReason ?? undefined}
            >
              rectifica nº {cert.rectifiesCertificationSeq ?? '?'}
            </div>
          )}
        </span>
      ),
    },
    {
      id: 'fecha',
      cabecera: 'Fecha',
      celda: (cert) => (
        <span className="text-gray-600">{formatDate(cert.certDate)}</span>
      ),
    },
    {
      id: 'pct',
      cabecera: '% Acumulado',
      alineacion: 'derecha',
      celda: (cert) => (
        <span className="font-mono font-medium">{pct(cert.cumulativePct)}</span>
      ),
    },
    {
      id: 'periodo',
      cabecera: 'Importe periodo',
      alineacion: 'derecha',
      celda: (cert) => (
        <span className="font-mono">
          <div>{formatEur(cert.periodAmount)}</div>
          <div className="text-xs text-gray-400">
            acum. {formatEur(cert.cumulativeAmount)}
          </div>
        </span>
      ),
    },
    {
      id: 'retencion',
      cabecera: 'Retención',
      alineacion: 'derecha',
      ocultaEnMovil: true,
      celda: (cert) => (
        <span className="font-mono text-amber-600">
          {formatEur(cert.retentionAmount)}
          <div className="text-xs text-gray-400">
            {cert.retentionPct.toFixed(1)} %
          </div>
        </span>
      ),
    },
    {
      id: 'neto',
      cabecera: 'Neto',
      alineacion: 'derecha',
      celda: (cert) => (
        <span className="font-mono font-semibold text-emerald-600">
          {formatEur(cert.periodAmount - cert.retentionAmount)}
        </span>
      ),
    },
    {
      id: 'estado',
      cabecera: 'Estado',
      celda: (cert) => <CertBadge status={cert.status} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Certificaciones"
        subtitle="Avance a origen por obra con facturación automática"
        count={projectId ? listado.total : undefined}
      >
        {projectId && (
          <button
            onClick={() =>
              exportsApi
                .download('certificaciones', { projectId })
                .catch((e) => toast(errText(e), 'error'))
            }
            className={btnGhostCls}
          >
            Exportar CSV
          </button>
        )}
        {projectId && (
          <Autorizado accion="crear" recurso="certificacion">
            <button
              onClick={() => setCreateOpen(true)}
              className={btnPrimaryCls + ' gap-1.5'}
            >
              <IconPlus size={16} />
              Nueva certificación
            </button>
          </Autorizado>
        )}
      </PageHeader>

      <BarraFiltros
        hayFiltros={filtros.status !== ''}
        onLimpiar={() => setFiltro('status', '')}
      >
        <FiltroObra
          obligatorio
          value={projectId}
          onChange={(v) => {
            setFiltro('projectId', v);
            setExpandedId(null);
          }}
        />
        <FiltroEstado<CertStatus>
          value={filtros.status as CertStatus | ''}
          onChange={(v) => setFiltro('status', v)}
          estados={CERT_STATUSES}
          etiquetas={CERT_STATUS_LABELS}
        />
      </BarraFiltros>

      {/* Sin obra seleccionada */}
      {!projectId && (
        <EmptyState
          icon={<IconClipboard size={40} />}
          title="Selecciona una obra"
        >
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
                etiqueta="Neto certificado"
                valor={formatEur(totalCertificado - totalRetencion)}
                detalle="sin retención"
                tono="bueno"
              />
              <KpiCard
                etiqueta="Retención acumulada"
                valor={formatEur(totalRetencion)}
                detalle="pendiente de liberar"
                tono="aviso"
              />
              <KpiCard
                etiqueta="% ejecutado"
                valor={pct(lastPct)}
                detalle={`Cert. nº ${lastCert?.seq ?? 0}`}
              />
              <KpiCard
                etiqueta="Certificaciones"
                valor={String(certs.length)}
                detalle={`${certs.filter((c) => c.status === 'facturada').length} facturadas`}
              />
            </div>
          )}

          <DataTable
            etiqueta="Certificaciones"
            columnas={columnas}
            filas={listado.filas}
            idFila={(c) => c.id}
            cargando={listado.cargando}
            actualizando={listado.actualizando}
            error={listado.error}
            onReintentar={listado.reintentar}
            hayFiltros={filtros.status !== ''}
            paginacion={{
              page: listado.page,
              pageSize: listado.pageSize,
              total: listado.total,
              onPageChange: listado.setPage,
              onPageSizeChange: listado.setPageSize,
            }}
            vacio={{
              icono: <IconClipboard size={40} />,
              titulo: 'Sin certificaciones',
            }}
            vacioConFiltros={{
              titulo: 'Ninguna certificación coincide con el filtro',
              onLimpiar: () => setFiltro('status', ''),
            }}
            idExpandida={expandedId}
            onExpandir={setExpandedId}
            filaExpandida={(cert) => (
              <div className="-mx-6 -my-4">
                <LinesPanel
                  certId={cert.id}
                  editable={
                    canEditCertification(cert.status) &&
                    can('editar', 'certificacion')
                  }
                />
                <div className="px-6 pb-4">
                  <TrazabilidadFiscal
                    entityType="certification"
                    entityId={cert.id}
                    fiscal={{
                      estado: CERT_STATUS_LABELS[cert.status],
                      rectificaA: etiquetaCertificacionOriginal(
                        cert.rectifiesCertificationSeq,
                      ),
                      motivo: cert.rectificationMotive,
                      tipo: cert.rectificationType,
                      facturaeReasonCode: cert.facturaeReasonCode,
                    }}
                  />
                </div>
              </div>
            )}
            acciones={(cert) => (
              <>
                {cert.status === 'borrador' &&
                  can('cambiarEstado', 'certificacion') && (
                    <button
                      onClick={() => setFacturarTarget(cert)}
                      className={btnGhostCls + ' gap-1.5 text-xs'}
                    >
                      <IconReceipt size={14} />
                      Facturar
                    </button>
                  )}
                {cert.status === 'facturada' &&
                  can('rectificar', 'certificacion') && (
                    <button
                      onClick={() => setRectifyTarget(cert)}
                      className={btnGhostCls + ' gap-1.5 text-xs'}
                      title="Nueva certificación que fija el acumulado correcto (puede bajar)"
                    >
                      Rectificar
                    </button>
                  )}
                {cert.status === 'borrador' &&
                  can('borrar', 'certificacion') && (
                    <button
                      onClick={() => setDeleteTarget(cert)}
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                      title="Eliminar"
                    >
                      <IconTrash size={14} />
                    </button>
                  )}
              </>
            )}
          />
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

      <RectificarCertModal
        open={!!rectifyTarget}
        cert={rectifyTarget}
        onSuccess={invalidate}
        onClose={() => setRectifyTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={`¿Eliminar certificación nº ${deleteTarget?.seq}?`}
        description="Se eliminará la certificación. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

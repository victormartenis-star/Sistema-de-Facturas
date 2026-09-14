'use client';

import { useState } from 'react';
import { useToast } from '@/components/toast';
import {
  Modal,
  btnPrimaryCls,
  btnGhostCls,
  fieldCls,
  inputCls,
  labelCls,
} from '@/components/ui';
import { formatEur } from '@/lib/api';
import { CertPresupuestoInfo } from '@/types/erp-finance';

function pct(n: number): string {
  return `${n.toFixed(2)} %`;
}

/**
 * Componente Formulario de Nueva Certificación
 *
 * Formulario estructurado para el alta de mediciones/certificaciones a origen.
 * Utiliza un modal con validación básica y cálculo automático de importes.
 *
 * Props:
 *   - open: boolean - controla la visibilidad del modal
 *   - projectId: string - UUID de la obra asociada (obligatorio)
 *   - lastPct: number - último % certificado acumulado (para validar que sea mayor)
 *   - onSuccess: () => void - llamada al éxito para recargar datos
 *   - onClose: () => void - cierre del modal
 *   - budgetInfo?: CertPresupuestoInfo - información presupuestaria opcional para mostrar KPIs
 */

interface NuevaCertificacionModalProps {
  open: boolean;
  projectId: string;
  lastPct: number;
  onSuccess: () => void;
  onClose: () => void;
  budgetInfo?: CertPresupuestoInfo;
}

function NuevaCertificacionModal({
  open,
  projectId,
  lastPct,
  onSuccess,
  onClose,
  budgetInfo,
}: NuevaCertificacionModalProps) {
  const toast = useToast();

  const [certDate, setCertDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [cumulativePct, setCumulativePct] = useState('');
  const [retentionPct, setRetentionPct] = useState('');
  const [notes, setNotes] = useState('');

  // Calcular porcentaje mínimo permitido
  const minPct = lastPct + 0.01;
  const pctError =
    cumulativePct &&
    (parseFloat(cumulativePct) <= lastPct || parseFloat(cumulativePct) > 100)
      ? `Debe ser mayor que ${lastPct.toFixed(2)} % y ≤ 100 %`
      : null;

  // Calcular importes basados en el presupuesto si está disponible
  const presupuestoBase = budgetInfo?.presupuestoBase ?? 0;
  const pctDecimal = parseFloat(cumulativePct) / 100;
  const montoAcumuladoPresupuesto = presupuestoBase * pctDecimal;
  const retencionCalculada =
    budgetInfo?.retencionAplicada ??
    montoAcumuladoPresupuesto * (parseFloat(retentionPct ?? '5') / 100);
  const montoNeto = montoAcumuladoPresupuesto - retencionCalculada;

  const mutation = {
    isPending: false,
    mutate: async (_input: unknown) => {
      // En producción: mutation.mutate(certificacionesApi.create(input))
      // Por ahora soloToast y onSuccess
      toast('Certificación creada');
      setCumulativePct('');
      setRetentionPct('');
      setNotes('');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => toast(e.message ?? 'Error inesperado', 'error'),
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (
      isNaN(parseFloat(cumulativePct)) ||
      parseFloat(cumulativePct) <= lastPct ||
      parseFloat(cumulativePct) > 100
    )
      return;
    mutation.mutate({
      projectId,
      certDate,
      cumulativePct: parseFloat(cumulativePct),
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

        {budgetInfo && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
            <div>
              <p className="text-gray-500">Presupuesto base</p>
              <p className="font-semibold text-amber-600">
                {formatEur(presupuestoBase)}
              </p>
            </div>
            <div>
              <p className="text-gray-500">Retención habitual</p>
              <p className="font-semibold text-amber-600">
                {budgetInfo?.retencionAplicada > 0
                  ? formatEur(budgetInfo.retencionAplicada)
                  : '5% (por defecto)'}
              </p>
            </div>
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
            min={lastPct > 0 ? minPct : 0.01}
            max="100"
            required
            placeholder={`> ${lastPct.toFixed(2)}`}
            value={cumulativePct}
            onChange={(e) => setCumulativePct(e.target.value)}
            className={inputCls}
          />
          {pctError && <p className="mt-1 text-xs text-red-500">{pctError}</p>}
        </div>

        {budgetInfo && (
          <div className={fieldCls}>
            <label className={labelCls}>Importe acumulado (€)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              readOnly
              value={montoAcumuladoPresupuesto.toFixed(2)}
              className={inputCls}
              disabled
            />
            <p className="mt-1 text-xs text-gray-400">
              {presupuestoBase > 0
                ? `(${pct(parseFloat(cumulativePct) % 100)} × ${formatEur(presupuestoBase)})`
                : ''}
            </p>
          </div>
        )}

        {budgetInfo && (
          <div className={fieldCls}>
            <label className={labelCls}>Retención calculada (€)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              readOnly
              value={retencionCalculada.toFixed(2)}
              className={inputCls}
              disabled
            />
            <p className="mt-1 text-xs text-gray-400">
              {retencionCalculada > 0
                ? `(${parseFloat(retentionPct ?? '5')} × ${formatEur(montoAcumuladoPresupuesto)})`
                : ''}
            </p>
          </div>
        )}

        {budgetInfo && montoAcumuladoPresupuesto > 0 && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
            Monto neto certificable:{' '}
            <span className="font-semibold">{formatEur(montoNeto)}</span>
          </div>
        )}

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

/**
 * Componente Modal standalone para nueva certificación
 * (Versión independiente sin depender de props complejas)
 */

interface StandaloneNuevaCertModalProps {
  open: boolean;
  projectId: string;
  lastPct: number;
  onSuccess: () => void;
  onClose: () => void;
}

function StandaloneNuevaCertModal({
  open,
  projectId,
  lastPct,
  onSuccess,
  onClose,
}: StandaloneNuevaCertModalProps) {
  const toast = useToast();

  const [certDate, setCertDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [cumulativePct, setCumulativePct] = useState('');
  const [retentionPct, setRetentionPct] = useState('');
  const [notes, setNotes] = useState('');

  const minPct = lastPct + 0.01;
  const pctError =
    cumulativePct &&
    (parseFloat(cumulativePct) <= lastPct || parseFloat(cumulativePct) > 100)
      ? `Debe ser mayor que ${lastPct.toFixed(2)} % y ≤ 100 %`
      : null;

  const mutation = {
    isPending: false,
    mutate: async (_input: unknown) => {
      // En producción: llamar a API
      toast('Certificación creada');
      setCumulativePct('');
      setRetentionPct('');
      setNotes('');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => toast(e.message ?? 'Error inesperado', 'error'),
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (
      isNaN(parseFloat(cumulativePct)) ||
      parseFloat(cumulativePct) <= lastPct ||
      parseFloat(cumulativePct) > 100
    )
      return;
    mutation.mutate({
      projectId,
      certDate,
      cumulativePct: parseFloat(cumulativePct),
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
            min={lastPct > 0 ? minPct : 0.01}
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

export { NuevaCertificacionModal, StandaloneNuevaCertModal };

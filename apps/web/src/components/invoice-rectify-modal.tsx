'use client';

import { useEffect, useState } from 'react';
import {
  RECTIFICATION_KINDS,
  type InvoiceDto,
  type InvoiceRectifyInput,
  type RectificationKind,
} from '@erp/shared';
import { IconLoader } from './icons';
import { MOTIVO_MAX, MOTIVO_MIN } from './reason-dialog';
import { Modal, btnPrimaryCls, fieldCls, labelCls } from './ui';

const KIND_LABELS: Record<RectificationKind, string> = {
  total: 'Total (anula el efecto de la factura entera)',
  diferencias: 'Por diferencias (solo corrige importes)',
};

interface DeltaLine {
  description: string;
  baseAmount: string;
  vatPct: number;
  projectId: string | null;
  phaseId: string | null;
  categoryId: string | null;
}

interface Props {
  open: boolean;
  invoice: InvoiceDto | null;
  saving: boolean;
  error: string | null;
  onSave: (input: InvoiceRectifyInput) => void;
  onClose: () => void;
}

const hoy = () => new Date().toISOString().slice(0, 10);

/**
 * Rectificar una factura aprobada o pagada. Crea la rectificativa en
 * borrador con numeración automática (serie R-AAAA-NNNN). En «por
 * diferencias» se parte de las líneas originales con importe 0: se teclea
 * solo el delta (positivo o negativo) de cada línea.
 */
export function InvoiceRectifyModal({
  open,
  invoice,
  saving,
  error,
  onSave,
  onClose,
}: Props) {
  const [clase, setClase] = useState<RectificationKind>('total');
  const [issueDate, setIssueDate] = useState(hoy());
  const [motivo, setMotivo] = useState('');
  const [lines, setLines] = useState<DeltaLine[]>([]);

  useEffect(() => {
    if (!open || !invoice) return;
    setClase('total');
    setIssueDate(hoy());
    setMotivo('');
    setLines(
      invoice.lines.map((l) => ({
        description: l.description,
        baseAmount: '0',
        vatPct: l.vatPct,
        projectId: l.projectId ?? null,
        phaseId: l.phaseId ?? null,
        categoryId: l.categoryId ?? null,
      })),
    );
  }, [open, invoice]);

  if (!invoice) return null;

  const deltas = lines.filter((l) => Number(l.baseAmount) !== 0);
  const motivoOk = motivo.trim().length >= MOTIVO_MIN;
  const lineasOk =
    clase === 'total' ||
    (deltas.length > 0 &&
      deltas.every((l) => Number.isFinite(Number(l.baseAmount))));

  function enviar() {
    onSave(
      clase === 'total'
        ? { clase, issueDate, motivo: motivo.trim() }
        : {
            clase,
            issueDate,
            motivo: motivo.trim(),
            lines: deltas.map((l) => ({
              description: l.description,
              baseAmount: Number(l.baseAmount),
              vatPct: l.vatPct,
              projectId: l.projectId,
              phaseId: l.phaseId,
              categoryId: l.categoryId,
            })),
          },
    );
  }

  return (
    <Modal
      open={open}
      title={`Rectificar la factura ${invoice.invoiceNumber}`}
      wide
      onClose={onClose}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Se crea una factura rectificativa en borrador; hasta aprobarla, la
          original no cambia.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="rect-clase">
              Clase
            </label>
            <select
              id="rect-clase"
              value={clase}
              onChange={(e) => setClase(e.target.value as RectificationKind)}
              className={fieldCls}
            >
              {RECTIFICATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="rect-fecha">
              Fecha de la rectificativa
            </label>
            <input
              id="rect-fecha"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className={fieldCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="rect-motivo">
            Motivo
          </label>
          <textarea
            id="rect-motivo"
            rows={2}
            maxLength={MOTIVO_MAX}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className={fieldCls}
            placeholder={`Mínimo ${MOTIVO_MIN} caracteres`}
          />
        </div>

        {clase === 'diferencias' && (
          <div>
            <p className={labelCls}>
              Diferencia por línea (base imponible; negativa si se reduce)
            </p>
            <ul className="space-y-2">
              {lines.map((l, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
                    {l.description}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={l.baseAmount}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, baseAmount: e.target.value } : x,
                        ),
                      )
                    }
                    aria-label={`Diferencia de la línea ${i + 1}`}
                    className={`${fieldCls} w-32 text-right`}
                  />
                  <span className="w-12 text-xs text-gray-500">
                    {l.vatPct} %
                  </span>
                </li>
              ))}
            </ul>
            {deltas.length === 0 && (
              <p className="mt-2 text-xs text-gray-500">
                Indica la diferencia en al menos una línea.
              </p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={enviar}
            disabled={saving || !motivoOk || !lineasOk || !issueDate}
            className={`${btnPrimaryCls} disabled:opacity-60`}
          >
            {saving && <IconLoader size={14} className="animate-spin" />}
            Crear rectificativa
          </button>
        </div>
      </div>
    </Modal>
  );
}

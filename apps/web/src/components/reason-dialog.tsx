'use client';

import { useEffect, useState } from 'react';
import { IconLoader } from './icons';
import { Modal, fieldCls, labelCls } from './ui';

/** Límites del motivo, los mismos que validan los esquemas de `@erp/shared`. */
export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 500;

interface ReasonDialogProps {
  open: boolean;
  title: string;
  description?: string;
  /** Etiqueta del botón de confirmación. */
  confirmLabel: string;
  /** Si es false, el motivo es opcional (p. ej. anular un borrador). */
  required?: boolean;
  loading?: boolean;
  error?: string | null;
  onConfirm: (motivo: string) => void;
  onCancel: () => void;
}

/**
 * Pide el motivo de una acción auditada (anular, devolver). Se usa en
 * facturas y albaranes: el endpoint exige `motivo` fuera de borrador.
 */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  required = true,
  loading = false,
  error = null,
  onConfirm,
  onCancel,
}: ReasonDialogProps) {
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (open) setMotivo('');
  }, [open]);

  const limpio = motivo.trim();
  const valido = required
    ? limpio.length >= MOTIVO_MIN
    : limpio.length === 0 || limpio.length >= MOTIVO_MIN;

  return (
    <Modal open={open} title={title} onClose={onCancel}>
      {description && (
        <p className="mb-4 text-sm whitespace-pre-line text-gray-500">
          {description}
        </p>
      )}
      <label className={labelCls} htmlFor="motivo">
        Motivo{required ? '' : ' (opcional)'}
      </label>
      <textarea
        id="motivo"
        rows={3}
        maxLength={MOTIVO_MAX}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        className={fieldCls}
        placeholder={`Mínimo ${MOTIVO_MIN} caracteres`}
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={loading}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          onClick={() => onConfirm(limpio)}
          disabled={loading || !valido}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
        >
          {loading && <IconLoader size={14} className="animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

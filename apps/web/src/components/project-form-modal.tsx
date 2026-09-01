'use client';

import { useEffect, useState } from 'react';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ProjectDto,
} from '@erp/shared';
import { ApiError } from '@/lib/api';

export interface ProjectFormValues {
  code: string;
  name: string;
  status: (typeof PROJECT_STATUSES)[number];
  startDate: string | null;
  expectedEnd: string | null;
  contractAmount: number | null;
  retentionPct: number;
  notes: string | null;
}

interface Props {
  open: boolean;
  /** Obra a editar; null = alta nueva. */
  project: ProjectDto | null;
  saving: boolean;
  error: ApiError | Error | null;
  onSave: (values: ProjectFormValues) => void;
  onClose: () => void;
}

interface FormState {
  code: string;
  name: string;
  status: (typeof PROJECT_STATUSES)[number];
  startDate: string;
  expectedEnd: string;
  contractAmount: string;
  retentionPct: string;
  notes: string;
}

const EMPTY: FormState = {
  code: '',
  name: '',
  status: 'en_curso',
  startDate: '',
  expectedEnd: '',
  contractAmount: '',
  retentionPct: '5',
  notes: '',
};

export function ProjectFormModal({
  open,
  project,
  saving,
  error,
  onSave,
  onClose,
}: Props) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (!open) return;
    setForm(
      project
        ? {
            code: project.code,
            name: project.name,
            status: project.status,
            startDate: project.startDate ?? '',
            expectedEnd: project.expectedEnd ?? '',
            contractAmount: project.contractAmount?.toString() ?? '',
            retentionPct: project.retentionPct.toString(),
            notes: project.notes ?? '',
          }
        : EMPTY,
    );
  }, [open, project]);

  if (!open) return null;

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : [];
  const errorFor = (field: string) =>
    fieldErrors.find((e) => e.field === field)?.message;

  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      code: form.code,
      name: form.name,
      status: form.status,
      startDate: form.startDate || null,
      expectedEnd: form.expectedEnd || null,
      contractAmount:
        form.contractAmount === ''
          ? null
          : Number(form.contractAmount.replace(',', '.')),
      retentionPct: Number(form.retentionPct.replace(',', '.')),
      notes: form.notes || null,
    });
  };

  const inputCls =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200';
  const labelCls = 'mb-1 block text-xs font-medium text-gray-600';
  const errCls = 'mt-1 text-xs text-red-600';

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold">
          {project ? 'Editar obra' : 'Nueva obra'}
        </h2>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className={labelCls} htmlFor="code">
                Código *
              </label>
              <input
                id="code"
                className={inputCls}
                placeholder="OBR-2026-001"
                value={form.code}
                onChange={(e) => set('code')(e.target.value)}
                required
              />
              {errorFor('code') && <p className={errCls}>{errorFor('code')}</p>}
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="name">
                Nombre *
              </label>
              <input
                id="name"
                className={inputCls}
                placeholder="Reforma nave industrial Pol. Sur"
                value={form.name}
                onChange={(e) => set('name')(e.target.value)}
                required
              />
              {errorFor('name') && <p className={errCls}>{errorFor('name')}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className={labelCls} htmlFor="status">
                Estado
              </label>
              <select
                id="status"
                className={inputCls}
                value={form.status}
                onChange={(e) => set('status')(e.target.value)}
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="startDate">
                Inicio
              </label>
              <input
                id="startDate"
                type="date"
                className={inputCls}
                value={form.startDate}
                onChange={(e) => set('startDate')(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="expectedEnd">
                Fin previsto
              </label>
              <input
                id="expectedEnd"
                type="date"
                className={inputCls}
                value={form.expectedEnd}
                onChange={(e) => set('expectedEnd')(e.target.value)}
              />
              {errorFor('expectedEnd') && (
                <p className={errCls}>{errorFor('expectedEnd')}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="contractAmount">
                Importe de contrato (€, sin IVA)
              </label>
              <input
                id="contractAmount"
                inputMode="decimal"
                className={inputCls}
                placeholder="120000"
                value={form.contractAmount}
                onChange={(e) => set('contractAmount')(e.target.value)}
              />
              {errorFor('contractAmount') && (
                <p className={errCls}>{errorFor('contractAmount')}</p>
              )}
            </div>
            <div>
              <label className={labelCls} htmlFor="retentionPct">
                Retención de garantía (%)
              </label>
              <input
                id="retentionPct"
                inputMode="decimal"
                className={inputCls}
                value={form.retentionPct}
                onChange={(e) => set('retentionPct')(e.target.value)}
              />
              {errorFor('retentionPct') && (
                <p className={errCls}>{errorFor('retentionPct')}</p>
              )}
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="notes">
              Notas
            </label>
            <textarea
              id="notes"
              rows={2}
              className={inputCls}
              value={form.notes}
              onChange={(e) => set('notes')(e.target.value)}
            />
          </div>

          {error && fieldErrors.length === 0 && (
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
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {saving
                ? 'Guardando…'
                : project
                  ? 'Guardar cambios'
                  : 'Crear obra'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

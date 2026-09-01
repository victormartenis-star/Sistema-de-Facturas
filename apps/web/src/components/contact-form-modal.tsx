'use client';

import { useEffect, useState } from 'react';
import {
  CONTACT_KINDS,
  CONTACT_KIND_LABELS,
  type CategoryDto,
  type ContactDto,
} from '@erp/shared';
import { ApiError } from '@/lib/api';

export interface ContactFormValues {
  kind: (typeof CONTACT_KINDS)[number];
  legalName: string;
  tradeName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  iban: string | null;
  paymentTermsDays: number;
  defaultCategoryId: string | null;
}

interface Props {
  open: boolean;
  /** Contacto a editar; null = alta nueva. */
  contact: ContactDto | null;
  categories: CategoryDto[];
  saving: boolean;
  error: ApiError | Error | null;
  onSave: (values: ContactFormValues) => void;
  onClose: () => void;
}

interface FormState {
  kind: (typeof CONTACT_KINDS)[number];
  legalName: string;
  tradeName: string;
  taxId: string;
  email: string;
  phone: string;
  iban: string;
  paymentTermsDays: string;
  defaultCategoryId: string;
}

const EMPTY: FormState = {
  kind: 'proveedor',
  legalName: '',
  tradeName: '',
  taxId: '',
  email: '',
  phone: '',
  iban: '',
  paymentTermsDays: '30',
  defaultCategoryId: '',
};

export function ContactFormModal({
  open,
  contact,
  categories,
  saving,
  error,
  onSave,
  onClose,
}: Props) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (!open) return;
    setForm(
      contact
        ? {
            kind: contact.kind,
            legalName: contact.legalName,
            tradeName: contact.tradeName ?? '',
            taxId: contact.taxId ?? '',
            email: contact.email ?? '',
            phone: contact.phone ?? '',
            iban: contact.iban ?? '',
            paymentTermsDays: contact.paymentTermsDays.toString(),
            defaultCategoryId: contact.defaultCategoryId ?? '',
          }
        : EMPTY,
    );
  }, [open, contact]);

  if (!open) return null;

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : [];
  const errorFor = (field: string) =>
    fieldErrors.find((e) => e.field === field)?.message;

  const set = (key: keyof FormState) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      kind: form.kind,
      legalName: form.legalName,
      tradeName: form.tradeName || null,
      taxId: form.taxId || null,
      email: form.email || null,
      phone: form.phone || null,
      iban: form.iban || null,
      paymentTermsDays: Number(form.paymentTermsDays),
      defaultCategoryId: form.defaultCategoryId || null,
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
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold">
          {contact ? 'Editar contacto' : 'Nuevo contacto'}
        </h2>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className={labelCls} htmlFor="kind">
                Tipo *
              </label>
              <select
                id="kind"
                className={inputCls}
                value={form.kind}
                onChange={(e) => set('kind')(e.target.value)}
              >
                {CONTACT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {CONTACT_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="legalName">
                Razón social *
              </label>
              <input
                id="legalName"
                className={inputCls}
                placeholder="Ferralla López S.L."
                value={form.legalName}
                onChange={(e) => set('legalName')(e.target.value)}
                required
              />
              {errorFor('legalName') && (
                <p className={errCls}>{errorFor('legalName')}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="tradeName">
                Nombre comercial
              </label>
              <input
                id="tradeName"
                className={inputCls}
                value={form.tradeName}
                onChange={(e) => set('tradeName')(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="taxId">
                NIF / CIF
              </label>
              <input
                id="taxId"
                className={inputCls}
                placeholder="B12345678"
                value={form.taxId}
                onChange={(e) => set('taxId')(e.target.value)}
              />
              {errorFor('taxId') && (
                <p className={errCls}>{errorFor('taxId')}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                className={inputCls}
                value={form.email}
                onChange={(e) => set('email')(e.target.value)}
              />
              {errorFor('email') && (
                <p className={errCls}>{errorFor('email')}</p>
              )}
            </div>
            <div>
              <label className={labelCls} htmlFor="phone">
                Teléfono
              </label>
              <input
                id="phone"
                className={inputCls}
                value={form.phone}
                onChange={(e) => set('phone')(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="iban">
              IBAN
            </label>
            <input
              id="iban"
              className={inputCls}
              placeholder="ES00 0000 0000 0000 0000 0000"
              value={form.iban}
              onChange={(e) => set('iban')(e.target.value)}
            />
            {errorFor('iban') && <p className={errCls}>{errorFor('iban')}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="paymentTermsDays">
                Condición de pago (días)
              </label>
              <input
                id="paymentTermsDays"
                inputMode="numeric"
                className={inputCls}
                value={form.paymentTermsDays}
                onChange={(e) => set('paymentTermsDays')(e.target.value)}
              />
              {errorFor('paymentTermsDays') && (
                <p className={errCls}>{errorFor('paymentTermsDays')}</p>
              )}
            </div>
            <div>
              <label className={labelCls} htmlFor="defaultCategoryId">
                Categoría de gasto habitual
              </label>
              <select
                id="defaultCategoryId"
                className={inputCls}
                value={form.defaultCategoryId}
                onChange={(e) => set('defaultCategoryId')(e.target.value)}
              >
                <option value="">— Sin categoría por defecto —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
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
                : contact
                  ? 'Guardar cambios'
                  : 'Crear contacto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

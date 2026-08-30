'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { ContactDto, ProjectDto, PurchaseOrderDto } from '@erp/shared';
import { ApiError, purchaseOrdersApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import {
  Modal,
  btnGhostCls,
  btnPrimaryCls,
  fieldCls,
  labelCls,
  selectCls,
} from '@/components/ui';

interface Props {
  order: PurchaseOrderDto | null;
  projects: ProjectDto[];
  contacts: ContactDto[];
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  projectId: string;
  contactId: string;
  orderDate: string;
  description: string;
  amount: string;
  expectedDate: string;
  requestedBy: string;
  urgent: boolean;
  notes: string;
}

const num = (s: string): number => {
  const n = Number(s.replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
};

function initialState(order: PurchaseOrderDto | null): FormState {
  return {
    projectId: order?.projectId ?? '',
    contactId: order?.contactId ?? '',
    orderDate: order?.orderDate ?? new Date().toISOString().slice(0, 10),
    description: order?.description ?? '',
    amount: order ? String(order.amount) : '',
    expectedDate: order?.expectedDate ?? '',
    requestedBy: order?.requestedBy ?? '',
    urgent: order?.urgent ?? false,
    notes: order?.notes ?? '',
  };
}

/**
 * Alta y edición de pedidos. El número no se teclea: lo compone el servidor
 * con el código de la obra y el correlativo, para que no haya dos criterios.
 */
export function OrderFormModal({
  order,
  projects,
  contacts,
  onClose,
  onSaved,
}: Props) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => initialState(order));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const suppliers = contacts.filter(
    (c) => c.kind === 'proveedor' || c.kind === 'ambos',
  );

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        contactId: form.contactId,
        orderDate: form.orderDate,
        description: form.description,
        amount: num(form.amount),
        expectedDate: form.expectedDate || null,
        requestedBy: form.requestedBy || null,
        urgent: form.urgent,
        notes: form.notes || null,
      };
      return order
        ? purchaseOrdersApi.update(order.id, payload)
        : purchaseOrdersApi.create({ ...payload, projectId: form.projectId });
    },
    onSuccess: (saved) => {
      toast(
        order ? 'Pedido actualizado' : `Pedido ${saved.orderNumber} creado`,
      );
      onSaved();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length > 0) {
        setFieldErrors(
          Object.fromEntries(e.fieldErrors.map((f) => [f.field, f.message])),
        );
        return;
      }
      toast(e instanceof Error ? e.message : 'Error inesperado', 'error');
    },
  });

  const Err = ({ name }: { name: string }) =>
    fieldErrors[name] ? (
      <p className="mt-1 text-xs text-red-600">{fieldErrors[name]}</p>
    ) : null;

  return (
    <Modal
      open
      title={order ? `Pedido ${order.orderNumber}` : 'Nuevo pedido'}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setFieldErrors({});
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Obra</label>
            {order ? (
              <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                {order.projectCode} · {order.projectName}
              </p>
            ) : (
              <select
                className={selectCls}
                value={form.projectId}
                onChange={(e) => set('projectId', e.target.value)}
                required
              >
                <option value="">Selecciona la obra…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </select>
            )}
            <Err name="projectId" />
          </div>

          <div>
            <label className={labelCls}>Proveedor</label>
            <select
              className={selectCls}
              value={form.contactId}
              onChange={(e) => set('contactId', e.target.value)}
              required
            >
              <option value="">Selecciona el proveedor…</option>
              {suppliers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName}
                </option>
              ))}
            </select>
            <Err name="contactId" />
          </div>
        </div>

        <div>
          <label className={labelCls}>Qué se pide</label>
          <input
            className={fieldCls}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Hormigón HA-25 para cimentación"
            required
          />
          <Err name="description" />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Importe (€)</label>
            <input
              className={fieldCls}
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
              required
            />
            <Err name="amount" />
          </div>
          <div>
            <label className={labelCls}>Fecha del pedido</label>
            <input
              type="date"
              className={fieldCls}
              value={form.orderDate}
              onChange={(e) => set('orderDate', e.target.value)}
              required
            />
            <Err name="orderDate" />
          </div>
          <div>
            <label className={labelCls}>Entrega comprometida</label>
            <input
              type="date"
              className={fieldCls}
              value={form.expectedDate}
              onChange={(e) => set('expectedDate', e.target.value)}
            />
            <Err name="expectedDate" />
          </div>
        </div>

        <div>
          <label className={labelCls}>Solicitante</label>
          <input
            className={fieldCls}
            value={form.requestedBy}
            onChange={(e) => set('requestedBy', e.target.value)}
            placeholder="Jefe de obra que pide el material"
          />
          <Err name="requestedBy" />
        </div>

        <label className="flex items-start gap-2 rounded-lg bg-orange-50 p-3">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.urgent}
            onChange={(e) => set('urgent', e.target.checked)}
          />
          <span className="text-xs text-orange-800">
            <span className="font-semibold">Pedido urgente</span> — autorizado
            verbalmente y regularizado después. Se marca para poder medir cuánta
            compra entra por esta vía.
          </span>
        </label>

        <div>
          <label className={labelCls}>Observaciones</label>
          <textarea
            className={fieldCls}
            rows={2}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnGhostCls} onClick={onClose}>
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
  );
}

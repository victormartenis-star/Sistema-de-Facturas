'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  ISP_LEGEND,
  type CategoryDto,
  type InvoiceCreateInput,
  type InvoiceDto,
  type InvoiceKind,
  type ProjectDto,
} from '@erp/shared';
import {
  ApiError,
  contactsApi,
  deliveryNotesApi,
  formatEur,
  phasesApi,
} from '@/lib/api';
import { IconCheck, IconPlus, IconTrash, IconX } from './icons';
import { Modal, btnPrimaryCls, fieldCls, labelCls } from './ui';

interface LineState {
  description: string;
  baseAmount: string;
  vatPct: string;
  projectId: string;
  phaseId: string;
  categoryId: string;
}

const EMPTY_LINE: LineState = {
  description: '',
  baseAmount: '',
  vatPct: '21',
  projectId: '',
  phaseId: '',
  categoryId: '',
};

const num = (s: string) => Number(s.replace(',', '.')) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

function LineRow({
  line,
  projects,
  categories,
  canRemove,
  onChange,
  onRemove,
}: {
  line: LineState;
  projects: ProjectDto[];
  categories: CategoryDto[];
  canRemove: boolean;
  onChange: (patch: Partial<LineState>) => void;
  onRemove: () => void;
}) {
  const phasesQuery = useQuery({
    queryKey: ['phases', line.projectId],
    queryFn: () => phasesApi.list(line.projectId),
    enabled: line.projectId !== '',
    staleTime: 60_000,
  });
  const phases = phasesQuery.data ?? [];

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 p-3">
      <div className="flex gap-2">
        <input
          className={`${fieldCls} flex-1`}
          placeholder="Descripción de la línea *"
          value={line.description}
          onChange={(e) => onChange({ description: e.target.value })}
          required
        />
        <input
          className={`${fieldCls} w-28 text-right`}
          inputMode="decimal"
          placeholder="Base €"
          value={line.baseAmount}
          onChange={(e) => onChange({ baseAmount: e.target.value })}
          required
        />
        <input
          className={`${fieldCls} w-20 text-right`}
          inputMode="decimal"
          title="% IVA"
          value={line.vatPct}
          onChange={(e) => onChange({ vatPct: e.target.value })}
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          title="Quitar línea"
          className="shrink-0 rounded-md p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
        >
          <IconTrash size={15} />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select
          className={fieldCls}
          value={line.projectId}
          onChange={(e) =>
            onChange({ projectId: e.target.value, phaseId: '' })
          }
        >
          <option value="">Sin obra (gasto general)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
        <select
          className={fieldCls}
          value={line.phaseId}
          onChange={(e) => onChange({ phaseId: e.target.value })}
          disabled={line.projectId === ''}
        >
          <option value="">Sin partida</option>
          {phases.map((f) => (
            <option key={f.id} value={f.id}>
              {f.code} · {f.name}
            </option>
          ))}
        </select>
        <select
          className={fieldCls}
          value={line.categoryId}
          onChange={(e) => onChange({ categoryId: e.target.value })}
        >
          <option value="">Sin categoría</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

interface Props {
  open: boolean;
  kind: InvoiceKind;
  /** Factura a editar (solo borradores); null = alta. */
  invoice: InvoiceDto | null;
  projects: ProjectDto[];
  categories: CategoryDto[];
  saving: boolean;
  error: ApiError | Error | null;
  onSave: (values: InvoiceCreateInput) => void;
  onClose: () => void;
}

export function InvoiceFormModal({
  open,
  kind,
  invoice,
  projects,
  categories,
  saving,
  error,
  onSave,
  onClose,
}: Props) {
  const [contactId, setContactId] = useState('');
  const [number, setNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isp, setIsp] = useState(false);
  const [retentionPct, setRetentionPct] = useState('0');
  const [releaseDate, setReleaseDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineState[]>([EMPTY_LINE]);
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);

  const contactsQuery = useQuery({
    queryKey: ['contacts', '', ''],
    queryFn: () => contactsApi.list('', ''),
    enabled: open,
    staleTime: 60_000,
  });
  const contactOptions = (contactsQuery.data ?? []).filter((c) =>
    kind === 'compra'
      ? c.kind === 'proveedor' || c.kind === 'ambos'
      : c.kind === 'cliente' || c.kind === 'ambos',
  );

  // Albaranes validados y libres del proveedor (candidatos al punteado)
  const availableNotesQuery = useQuery({
    queryKey: ['delivery-notes', 'available', contactId],
    queryFn: () => deliveryNotesApi.list({ availableForContact: contactId }),
    enabled: open && kind === 'compra' && contactId !== '',
  });
  const availableNotes = useMemo(() => {
    const fromApi = availableNotesQuery.data ?? [];
    if (!invoice) return fromApi;
    // Al editar, los albaranes ya vinculados a esta factura siguen visibles
    const linked = invoice.deliveryNotes.map((n) => ({
      id: n.id,
      noteNumber: n.noteNumber,
      amount: n.amount,
    }));
    const apiIds = new Set(fromApi.map((n) => n.id));
    return [
      ...fromApi.map((n) => ({
        id: n.id,
        noteNumber: n.noteNumber,
        amount: n.amount,
      })),
      ...linked.filter((n) => !apiIds.has(n.id)),
    ];
  }, [availableNotesQuery.data, invoice]);

  useEffect(() => {
    if (!open) return;
    if (invoice) {
      setContactId(invoice.contactId);
      setNumber(invoice.invoiceNumber);
      setIssueDate(invoice.issueDate);
      setDueDate(invoice.dueDate ?? '');
      setIsp(invoice.isp);
      setRetentionPct(invoice.retentionPct.toString());
      setReleaseDate(invoice.retentionReleaseDate ?? '');
      setNotes(invoice.notes ?? '');
      setLines(
        invoice.lines.map((l) => ({
          description: l.description,
          baseAmount: l.baseAmount.toString(),
          vatPct: l.vatPct.toString(),
          projectId: l.projectId ?? '',
          phaseId: l.phaseId ?? '',
          categoryId: l.categoryId ?? '',
        })),
      );
      setSelectedNotes(invoice.deliveryNotes.map((n) => n.id));
    } else {
      setContactId('');
      setNumber('');
      setIssueDate(new Date().toISOString().slice(0, 10));
      setDueDate('');
      setIsp(false);
      setRetentionPct('0');
      setReleaseDate('');
      setNotes('');
      setLines([EMPTY_LINE]);
      setSelectedNotes([]);
    }
  }, [open, invoice]);

  const base = round2(lines.reduce((s, l) => s + num(l.baseAmount), 0));
  const vat = isp
    ? 0
    : round2(
        lines.reduce((s, l) => s + (num(l.baseAmount) * num(l.vatPct)) / 100, 0),
      );
  const total = round2(base + vat);
  const retention = round2((base * num(retentionPct)) / 100);

  const notesTotal = round2(
    availableNotes
      .filter((n) => selectedNotes.includes(n.id))
      .reduce((s, n) => s + n.amount, 0),
  );
  const matched = Math.abs(notesTotal - base) <= 0.01;

  const toggleNote = (id: string) =>
    setSelectedNotes((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      kind,
      contactId,
      invoiceNumber: number,
      issueDate,
      dueDate: dueDate || null,
      isp,
      retentionPct: num(retentionPct),
      retentionReleaseDate: releaseDate || null,
      notes: notes || null,
      lines: lines.map((l) => ({
        description: l.description,
        baseAmount: num(l.baseAmount),
        vatPct: num(l.vatPct),
        projectId: l.projectId || null,
        phaseId: l.phaseId || null,
        categoryId: l.categoryId || null,
      })),
      deliveryNoteIds: kind === 'compra' ? selectedNotes : [],
    });
  };

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : [];

  return (
    <Modal
      open={open}
      wide
      title={
        invoice
          ? `Editar factura ${invoice.invoiceNumber}`
          : kind === 'compra'
            ? 'Nueva factura de compra'
            : 'Nueva factura de venta'
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>
              {kind === 'compra' ? 'Proveedor *' : 'Cliente *'}
            </label>
            <select
              className={fieldCls}
              value={contactId}
              onChange={(e) => {
                setContactId(e.target.value);
                setSelectedNotes([]);
              }}
              required
            >
              <option value="">Selecciona…</option>
              {contactOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={labelCls}>Nº factura *</label>
              <input
                className={fieldCls}
                placeholder={kind === 'compra' ? 'FC-1234' : 'FV-2026-001'}
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelCls}>Emisión *</label>
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
        </div>

        {/* Líneas con imputación analítica */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs font-semibold text-gray-700 uppercase">
              Líneas e imputación (obra · partida · categoría)
            </label>
            <button
              type="button"
              onClick={() => setLines((ls) => [...ls, EMPTY_LINE])}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50"
            >
              <IconPlus size={13} />
              Añadir línea
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((line, i) => (
              <LineRow
                key={i}
                line={line}
                projects={projects}
                categories={categories}
                canRemove={lines.length > 1}
                onChange={(patch) =>
                  setLines((ls) =>
                    ls.map((l, j) => (j === i ? { ...l, ...patch } : l)),
                  )
                }
                onRemove={() =>
                  setLines((ls) => ls.filter((_, j) => j !== i))
                }
              />
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-500">
            Para repartir la factura entre varias obras o partidas, añade una
            línea por cada imputación con su parte de la base.
          </p>
        </div>

        {/* Fiscalidad: ISP y retención de garantía */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={isp}
              onChange={(e) => setIsp(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-amber-500"
            />
            <span>
              Inversión del sujeto pasivo
              <span className="block text-xs text-gray-500">
                Exime el IVA y añade la leyenda legal
              </span>
            </span>
          </label>
          <div>
            <label className={labelCls}>Retención de garantía (%)</label>
            <input
              className={fieldCls}
              inputMode="decimal"
              value={retentionPct}
              onChange={(e) => setRetentionPct(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Liberación de la garantía</label>
            <input
              type="date"
              className={fieldCls}
              value={releaseDate}
              onChange={(e) => setReleaseDate(e.target.value)}
            />
          </div>
        </div>

        {isp && (
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
            {ISP_LEGEND}
          </p>
        )}

        {/* Punteado de albaranes (solo compra) */}
        {kind === 'compra' && contactId && (
          <div className="rounded-xl border border-gray-200 p-3">
            <p className="mb-2 text-xs font-semibold text-gray-700 uppercase">
              Albaranes validados del proveedor (punteado)
            </p>
            {availableNotes.length === 0 ? (
              <p className="text-sm text-gray-500">
                Este proveedor no tiene albaranes validados pendientes de
                facturar. Sin albaranes no podrás aprobar la factura.
              </p>
            ) : (
              <>
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {availableNotes.map((n) => (
                    <li key={n.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={selectedNotes.includes(n.id)}
                          onChange={() => toggleNote(n.id)}
                          className="h-4 w-4 accent-amber-500"
                        />
                        <span className="flex-1 font-medium">
                          {n.noteNumber}
                        </span>
                        <span className="tabular-nums">
                          {formatEur(n.amount)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div
                  className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                    matched
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {matched ? <IconCheck size={14} /> : <IconX size={14} />}
                  Albaranes: {formatEur(notesTotal)} · Base factura:{' '}
                  {formatEur(base)}
                  {matched
                    ? ' — cuadra'
                    : ` — descuadre de ${formatEur(round2(notesTotal - base))}`}
                </div>
              </>
            )}
          </div>
        )}

        <div>
          <label className={labelCls}>Notas</label>
          <textarea
            rows={2}
            className={fieldCls}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {/* Totales */}
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-gray-50 px-4 py-3 text-sm sm:grid-cols-5">
          <div>
            <p className="text-xs text-gray-500">Base</p>
            <p className="font-semibold tabular-nums">{formatEur(base)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">IVA {isp ? '(ISP)' : ''}</p>
            <p className="font-semibold tabular-nums">{formatEur(vat)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Total</p>
            <p className="font-semibold tabular-nums">{formatEur(total)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Retención</p>
            <p className="font-semibold text-amber-700 tabular-nums">
              −{formatEur(retention)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Líquido vencimiento</p>
            <p className="font-semibold tabular-nums">
              {formatEur(round2(total - retention))}
            </p>
          </div>
        </div>

        {error && fieldErrors.length > 0 && (
          <ul className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {fieldErrors.map((fe, i) => (
              <li key={i}>
                {fe.field}: {fe.message}
              </li>
            ))}
          </ul>
        )}
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
          <button type="submit" disabled={saving} className={btnPrimaryCls}>
            {saving
              ? 'Guardando…'
              : invoice
                ? 'Guardar cambios'
                : 'Crear borrador'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

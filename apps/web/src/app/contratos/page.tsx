'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CONTRATO_OBRA_ESTADO_FIRMA_LABELS,
  CONTRATO_OBRA_TIPOS,
  CONTRATO_OBRA_TIPO_LABELS,
  type ContratoObraCreateInput,
  type ContratoObraDto,
  type ContratoObraEstadoFirma,
} from '@erp/shared';
import {
  ApiError,
  contactsApi,
  contratosObraApi,
  documentFileUrl,
  documentsApi,
  formatDate,
  formatEur,
  projectsApi,
} from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconEuro, IconUpload } from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  Modal,
  PageHeader,
  TableSkeleton,
  btnGhostCls,
  btnPrimaryCls,
  fieldCls,
  labelCls,
  selectCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

const ESTADO_TONE: Record<ContratoObraEstadoFirma, string> = {
  borrador: 'bg-gray-100 text-gray-600',
  pendiente_firma: 'bg-amber-100 text-amber-700',
  firmado: 'bg-emerald-100 text-emerald-700',
  rescindido: 'bg-red-100 text-red-700',
};

function EstadoBadge({ estado }: { estado: ContratoObraEstadoFirma }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${ESTADO_TONE[estado]}`}
    >
      {CONTRATO_OBRA_ESTADO_FIRMA_LABELS[estado]}
    </span>
  );
}

function NewContratoModal({
  open,
  saving,
  error,
  onSave,
  onClose,
}: {
  open: boolean;
  saving: boolean;
  error: Error | null;
  onSave: (v: ContratoObraCreateInput) => void;
  onClose: () => void;
}) {
  const [projectId, setProjectId] = useState('');
  const [contactId, setContactId] = useState('');
  const [tipo, setTipo] =
    useState<ContratoObraCreateInput['tipo']>('subcontrata');
  const [importe, setImporte] = useState('');
  const [retencionPct, setRetencionPct] = useState('5');
  const [condicionesAbono, setCondicionesAbono] = useState('');

  useEffect(() => {
    if (!open) return;
    setProjectId('');
    setContactId('');
    setTipo('subcontrata');
    setImporte('');
    setRetencionPct('5');
    setCondicionesAbono('');
  }, [open]);

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const contactsQuery = useQuery({
    queryKey: ['contacts', '', ''],
    queryFn: () => contactsApi.list('', ''),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : [];

  return (
    <Modal open={open} title="Nuevo contrato" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            projectId,
            contactId,
            tipo,
            importe: Number(importe),
            retencionPct: Number(retencionPct),
            condicionesAbono: condicionesAbono || undefined,
          });
        }}
        className="space-y-4"
      >
        <div>
          <label className={labelCls}>Obra *</label>
          <select
            className={selectCls}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            required
          >
            <option value="">Selecciona una obra…</option>
            {projectsQuery.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Subcontratista / cliente *</label>
          <select
            className={selectCls}
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            required
          >
            <option value="">Selecciona un contacto…</option>
            {contactsQuery.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Tipo de contrato *</label>
          <select
            className={selectCls}
            value={tipo}
            onChange={(e) =>
              setTipo(e.target.value as ContratoObraCreateInput['tipo'])
            }
          >
            {CONTRATO_OBRA_TIPOS.map((t) => (
              <option key={t} value={t}>
                {CONTRATO_OBRA_TIPO_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Importe (€) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className={fieldCls}
              value={importe}
              onChange={(e) => setImporte(e.target.value)}
              required
            />
          </div>
          <div>
            <label className={labelCls}>Retención garantía (%)</label>
            <input
              type="number"
              step="0.5"
              min="0"
              max="50"
              className={fieldCls}
              value={retencionPct}
              onChange={(e) => setRetencionPct(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Cláusulas de retención / abonos</label>
          <textarea
            rows={3}
            className={fieldCls}
            value={condicionesAbono}
            onChange={(e) => setCondicionesAbono(e.target.value)}
            placeholder="Condiciones de pagos a cuenta, liberación de retención…"
          />
        </div>

        {error && fieldErrors.length === 0 && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error.message}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={btnGhostCls}>
            Cancelar
          </button>
          <button type="submit" disabled={saving} className={btnPrimaryCls}>
            {saving ? 'Creando…' : 'Crear contrato'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ContratoRow({ contrato }: { contrato: ContratoObraDto }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof contratosObraApi.update>[1]) =>
      contratosObraApi.update(contrato.id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contratos-obra'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const doc = await documentsApi.upload(file, {
        projectId: contrato.projectId,
        docType: 'contrato',
      });
      await updateMutation.mutateAsync({ documentId: doc.id });
      toast('PDF adjuntado');
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setUploading(false);
    }
  }

  const puedeFirmar =
    contrato.estadoFirma === 'borrador' ||
    contrato.estadoFirma === 'pendiente_firma';

  return (
    <tr className="border-b border-gray-100 last:border-0 hover:bg-amber-50/40">
      <td className="px-4 py-3 font-medium">
        {CONTRATO_OBRA_TIPO_LABELS[contrato.tipo]}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {formatEur(contrato.importe)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {contrato.retencionPct.toFixed(1)} %
      </td>
      <td className="px-4 py-3 text-gray-600">
        {contrato.fechaFirma ? formatDate(contrato.fechaFirma) : '—'}
      </td>
      <td className="px-4 py-3">
        {contrato.documentId ? (
          <a
            href={documentFileUrl(contrato.documentId)}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-amber-600 hover:underline"
          >
            Ver PDF
          </a>
        ) : (
          <span className="text-xs text-gray-400">Sin adjuntar</span>
        )}
      </td>
      <td className="px-4 py-3">
        <EstadoBadge estado={contrato.estadoFirma} />
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = '';
            }}
          />
          <button
            className={btnGhostCls + ' gap-1 text-xs'}
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <IconUpload size={12} />
            {uploading ? 'Subiendo…' : 'PDF'}
          </button>
          {puedeFirmar && (
            <button
              className={btnGhostCls + ' text-xs text-emerald-600'}
              disabled={updateMutation.isPending}
              onClick={() =>
                updateMutation.mutate(
                  {
                    estadoFirma: 'firmado',
                    fechaFirma:
                      contrato.fechaFirma ??
                      new Date().toISOString().slice(0, 10),
                  },
                  {
                    onSuccess: () => toast('Contrato firmado'),
                  },
                )
              }
            >
              Firmar
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function ContratosObraPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [projectFilter, setProjectFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
  });

  const query = useQuery({
    queryKey: ['contratos-obra', projectFilter],
    queryFn: () => contratosObraApi.list(projectFilter || undefined),
  });

  const createMutation = useMutation({
    mutationFn: (input: ContratoObraCreateInput) =>
      contratosObraApi.create(input),
    onSuccess: () => {
      toast('Contrato creado');
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ['contratos-obra'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const contratos = query.data ?? [];

  return (
    <div>
      <PageHeader
        title="Contratación y gestión documental"
        subtitle="Contratos con subcontratistas, proveedores y clientes, con su PDF firmado"
        count={contratos.length}
      >
        <select
          className={selectCls}
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="">Todas las obras</option>
          {projectsQuery.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
        <button className={btnPrimaryCls} onClick={() => setFormOpen(true)}>
          Nuevo contrato
        </button>
      </PageHeader>

      {query.isError && <ErrorBanner message={errText(query.error)} />}
      {query.isLoading && <TableSkeleton />}

      {query.isSuccess && contratos.length === 0 && (
        <EmptyState
          icon={<IconEuro size={26} />}
          title="Todavía no hay contratos"
        >
          <p className="mx-auto max-w-md text-sm text-gray-500">
            Crea un contrato para empezar a subir su PDF firmado y controlar sus
            cláusulas de retención y abonos.
          </p>
        </EmptyState>
      )}

      {contratos.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 text-right font-medium">Importe</th>
                <th className="px-4 py-3 text-right font-medium">Retención</th>
                <th className="px-4 py-3 font-medium">Fecha firma</th>
                <th className="px-4 py-3 font-medium">Documento</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {contratos.map((c) => (
                <ContratoRow key={c.id} contrato={c} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewContratoModal
        open={formOpen}
        saving={createMutation.isPending}
        error={(createMutation.error as ApiError | null) ?? null}
        onSave={(v) => createMutation.mutate(v)}
        onClose={() => setFormOpen(false)}
      />
    </div>
  );
}

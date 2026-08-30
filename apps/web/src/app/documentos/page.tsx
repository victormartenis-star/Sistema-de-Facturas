'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  DOC_STATUSES,
  DOC_STATUS_LABELS,
  DOC_TYPES,
  DOC_TYPE_LABELS,
  DOCUMENT_ACCEPTED_MIME_TYPES,
  DOCUMENT_MAX_SIZE_MB,
  type DocType,
  type DocumentDto,
  type DocumentUpdateInput,
} from '@erp/shared';
import {
  documentFileUrl,
  documentsApi,
  formatDate,
  projectsApi,
} from '@/lib/api';
import { useDebouncedValue } from '@/lib/hooks';
import { DocStatusBadge } from '@/components/doc-status-badge';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import {
  IconCheck,
  IconEye,
  IconFileText,
  IconLoader,
  IconTrash,
  IconUpload,
  IconX,
} from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  SearchInput,
  TableSkeleton,
  selectCls,
} from '@/components/ui';

interface UploadResult {
  fileName: string;
  ok: boolean;
  message: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentosPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState('');
  const [docType, setDocType] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DocumentDto | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = useQuery({
    queryKey: ['documents', debouncedSearch, status, docType],
    queryFn: () => documentsApi.list(debouncedSearch, status, docType),
  });

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: DocumentUpdateInput }) =>
      documentsApi.update(id, input),
    onSuccess: () => {
      toast('Documento actualizado');
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (err) => {
      toast(
        err instanceof Error ? err.message : 'No se pudo actualizar',
        'error',
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.remove(id),
    onSuccess: () => {
      toast('Documento eliminado');
      qc.invalidateQueries({ queryKey: ['documents'] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast(
        err instanceof Error ? err.message : 'No se pudo eliminar',
        'error',
      );
      setDeleteTarget(null);
    },
  });

  async function handleFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0 || uploading) return;
    setUploading(true);
    setResults([]);
    const outcomes: UploadResult[] = [];
    for (const file of files) {
      try {
        await documentsApi.upload(file);
        outcomes.push({
          fileName: file.name,
          ok: true,
          message: 'Subido correctamente',
        });
      } catch (err) {
        outcomes.push({
          fileName: file.name,
          ok: false,
          message: err instanceof Error ? err.message : 'Error desconocido',
        });
      }
    }
    setResults(outcomes);
    setUploading(false);
    const okCount = outcomes.filter((o) => o.ok).length;
    const failCount = outcomes.length - okCount;
    if (failCount === 0) {
      toast(
        okCount === 1
          ? 'Documento subido correctamente'
          : `${okCount} documentos subidos correctamente`,
      );
    } else {
      toast(
        `${okCount} de ${outcomes.length} archivos subidos; revisa los errores`,
        'error',
      );
    }
    qc.invalidateQueries({ queryKey: ['documents'] });
  }

  const docs = query.data ?? [];
  const projects = projectsQuery.data ?? [];

  return (
    <div className="animate-fade-in-up">
      <PageHeader title="Documentos" count={docs.length}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por nombre de archivo…"
        />
        <select
          className={selectCls}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todos los estados</option>
          {DOC_STATUSES.map((s) => (
            <option key={s} value={s}>
              {DOC_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
        >
          <option value="">Todos los tipos</option>
          {DOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {DOC_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </PageHeader>

      {/* Zona de subida */}
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`mb-6 cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all ${
          dragOver
            ? 'scale-[1.01] border-amber-500 bg-amber-50 shadow-lg shadow-amber-100'
            : 'border-gray-300 bg-white hover:border-amber-400 hover:bg-amber-50/40'
        }`}
      >
        <span
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl transition ${
            dragOver ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-500'
          }`}
        >
          {uploading ? (
            <IconLoader size={26} className="animate-spin" />
          ) : (
            <IconUpload size={26} />
          )}
        </span>
        <p className="mt-4 font-medium text-gray-700">
          {uploading
            ? 'Subiendo archivos…'
            : 'Arrastra aquí facturas, albaranes o tickets, o haz clic para elegir archivos'}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          PDF, JPG, PNG o WEBP · máximo {DOCUMENT_MAX_SIZE_MB} MB por archivo ·
          los duplicados se detectan automáticamente
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={DOCUMENT_ACCEPTED_MIME_TYPES.join(',')}
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {results.length > 0 && (
        <div className="animate-fade-in-up mb-6 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm">
          <div className="mb-2 flex items-center">
            <span className="font-medium text-gray-700">
              Resultado de la subida
            </span>
            <button
              onClick={() => setResults([])}
              className="ml-auto rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Cerrar resultado"
            >
              <IconX size={14} />
            </button>
          </div>
          <ul className="space-y-1">
            {results.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                    r.ok
                      ? 'bg-emerald-100 text-emerald-600'
                      : 'bg-red-100 text-red-600'
                  }`}
                >
                  {r.ok ? <IconCheck size={10} /> : <IconX size={10} />}
                </span>
                <span
                  className={`truncate ${r.ok ? 'text-gray-700' : 'text-red-700'}`}
                >
                  {r.fileName}
                  {!r.ok && ` — ${r.message}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {query.isLoading && <TableSkeleton />}

      {query.isError && (
        <ErrorBanner message={(query.error as Error).message} />
      )}

      {query.isSuccess && docs.length === 0 && (
        <EmptyState
          icon={<IconFileText size={26} />}
          title={
            search || status || docType
              ? 'Ningún documento coincide con el filtro'
              : 'Todavía no hay documentos: sube la primera factura'
          }
        />
      )}

      {docs.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                <th className="px-4 py-3 font-medium">Archivo</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Obra</th>
                <th className="px-4 py-3 font-medium">Subido</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr
                  key={d.id}
                  className="border-b border-gray-100 transition-colors last:border-0 hover:bg-amber-50/40"
                >
                  <td className="max-w-xs px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                        <IconFileText size={15} />
                      </span>
                      <div className="min-w-0">
                        <span
                          className="block truncate font-medium"
                          title={d.fileName}
                        >
                          {d.fileName}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {formatBytes(d.fileSize)}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs transition focus:border-amber-500 focus:outline-none"
                      value={d.docType ?? ''}
                      onChange={(e) =>
                        updateMutation.mutate({
                          id: d.id,
                          input: {
                            docType:
                              e.target.value === ''
                                ? null
                                : (e.target.value as DocType),
                          },
                        })
                      }
                    >
                      <option value="">Sin clasificar</option>
                      {DOC_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {DOC_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <DocStatusBadge status={d.status} />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="max-w-40 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs transition focus:border-amber-500 focus:outline-none"
                      value={d.projectId ?? ''}
                      onChange={(e) =>
                        updateMutation.mutate({
                          id: d.id,
                          input: {
                            projectId:
                              e.target.value === '' ? null : e.target.value,
                          },
                        })
                      }
                    >
                      <option value="">Sin obra</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} · {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatDate(d.createdAt.slice(0, 10))}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                      <a
                        href={documentFileUrl(d.id)}
                        target="_blank"
                        rel="noreferrer"
                        title="Ver original"
                        className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                      >
                        <IconEye size={15} />
                      </a>
                      <button
                        onClick={() => setDeleteTarget(d)}
                        title="Eliminar"
                        className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                      >
                        <IconTrash size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`¿Eliminar el documento "${deleteTarget?.fileName ?? ''}"?`}
        description="El archivo dejará de aparecer en el listado."
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

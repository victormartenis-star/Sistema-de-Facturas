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
import { DocStatusBadge } from '@/components/doc-status-badge';

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
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [docType, setDocType] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = useQuery({
    queryKey: ['documents', search, status, docType],
    queryFn: () => documentsApi.list(search, status, docType),
  });

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: DocumentUpdateInput }) =>
      documentsApi.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
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
    qc.invalidateQueries({ queryKey: ['documents'] });
  }

  const confirmDelete = (d: DocumentDto) => {
    if (window.confirm(`¿Eliminar el documento "${d.fileName}"?`)) {
      deleteMutation.mutate(d.id);
    }
  };

  const docs = query.data ?? [];
  const projects = projectsQuery.data ?? [];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Documentos</h1>
        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
          {docs.length}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            className="w-56 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
            placeholder="Buscar por nombre de archivo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
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
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
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
        </div>
      </div>

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
        className={`mb-6 cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragOver
            ? 'border-amber-500 bg-amber-50'
            : 'border-gray-300 bg-white hover:border-amber-400'
        }`}
      >
        <p className="text-4xl">📄</p>
        <p className="mt-3 font-medium text-gray-700">
          {uploading
            ? 'Subiendo…'
            : 'Arrastra aquí facturas, albaranes o tickets, o haz clic para elegir archivos'}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          PDF, JPG, PNG o WEBP · máximo {DOCUMENT_MAX_SIZE_MB} MB por archivo
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
        <div className="mb-6 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm">
          <div className="mb-1 flex items-center">
            <span className="font-medium text-gray-700">
              Resultado de la subida
            </span>
            <button
              onClick={() => setResults([])}
              className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100"
            >
              Cerrar
            </button>
          </div>
          <ul className="space-y-0.5">
            {results.map((r, i) => (
              <li
                key={i}
                className={r.ok ? 'text-emerald-700' : 'text-red-700'}
              >
                {r.ok ? '✓' : '✗'} {r.fileName}
                {!r.ok && ` — ${r.message}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {query.isLoading && (
        <p className="py-12 text-center text-sm text-gray-500">Cargando…</p>
      )}

      {query.isError && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          No se pudo cargar el listado: {(query.error as Error).message}.
          ¿Está la API en marcha?
        </p>
      )}

      {query.isSuccess && docs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-16 text-center">
          <p className="text-4xl">🗂️</p>
          <p className="mt-3 font-medium text-gray-700">
            {search || status || docType
              ? 'Ningún documento coincide con el filtro'
              : 'Todavía no hay documentos: sube la primera factura'}
          </p>
        </div>
      )}

      {docs.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
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
                  className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                >
                  <td className="max-w-xs px-4 py-3 font-medium">
                    <span className="block truncate" title={d.fileName}>
                      {d.fileName}
                    </span>
                    <span className="block text-xs font-normal text-gray-500">
                      {formatBytes(d.fileSize)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs focus:border-amber-500 focus:outline-none"
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
                      className="max-w-40 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs focus:border-amber-500 focus:outline-none"
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
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <a
                      href={documentFileUrl(d.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                    >
                      Ver
                    </a>
                    <button
                      onClick={() => confirmDelete(d)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-red-50 hover:text-red-700"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ProjectDto,
} from '@erp/shared';
import { ApiError, formatDate, formatEur, projectsApi } from '@/lib/api';
import { StatusBadge } from '@/components/status-badge';
import {
  ProjectFormModal,
  type ProjectFormValues,
} from '@/components/project-form-modal';

export default function ObrasPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectDto | null>(null);

  const query = useQuery({
    queryKey: ['projects', search, status],
    queryFn: () => projectsApi.list(search, status),
  });

  const saveMutation = useMutation({
    mutationFn: (values: ProjectFormValues) =>
      editing
        ? projectsApi.update(editing.id, values)
        : projectsApi.create(values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => projectsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  const openCreate = () => {
    setEditing(null);
    saveMutation.reset();
    setModalOpen(true);
  };

  const openEdit = (p: ProjectDto) => {
    setEditing(p);
    saveMutation.reset();
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const confirmDelete = (p: ProjectDto) => {
    if (
      window.confirm(
        `¿Eliminar la obra "${p.name}" (${p.code})?\nPodrás recuperarla más adelante: es un borrado lógico.`,
      )
    ) {
      deleteMutation.mutate(p.id);
    }
  };

  const projects = query.data ?? [];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Obras</h1>
        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
          {projects.length}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            className="w-56 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
            placeholder="Buscar por nombre o código…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Todos los estados</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            onClick={openCreate}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
          >
            + Nueva obra
          </button>
        </div>
      </div>

      {query.isLoading && (
        <p className="py-12 text-center text-sm text-gray-500">Cargando…</p>
      )}

      {query.isError && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          No se pudo cargar el listado: {(query.error as Error).message}.
          ¿Está la API en marcha?
        </p>
      )}

      {query.isSuccess && projects.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-16 text-center">
          <p className="text-4xl">🏗️</p>
          <p className="mt-3 font-medium text-gray-700">
            {search || status
              ? 'Ninguna obra coincide con el filtro'
              : 'Todavía no hay obras'}
          </p>
          {!search && !status && (
            <button
              onClick={openCreate}
              className="mt-4 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
            >
              Crear la primera obra
            </button>
          )}
        </div>
      )}

      {projects.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">Código</th>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Inicio</th>
                <th className="px-4 py-3 text-right font-medium">
                  Contrato (sin IVA)
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {p.code}
                  </td>
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatDate(p.startDate)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatEur(p.contractAmount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(p)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => confirmDelete(p)}
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

      <ProjectFormModal
        open={modalOpen}
        project={editing}
        saving={saveMutation.isPending}
        error={(saveMutation.error as ApiError | null) ?? null}
        onSave={(values) => saveMutation.mutate(values)}
        onClose={closeModal}
      />
    </div>
  );
}

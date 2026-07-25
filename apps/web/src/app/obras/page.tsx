'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ProjectDto,
} from '@erp/shared';
import { ApiError, formatDate, formatEur, projectsApi } from '@/lib/api';
import { useDebouncedValue } from '@/lib/hooks';
import { StatusBadge } from '@/components/status-badge';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import {
  IconBuilding,
  IconPencil,
  IconPlus,
  IconTrash,
} from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  SearchInput,
  SortableTh,
  TableSkeleton,
  btnPrimaryCls,
  selectCls,
} from '@/components/ui';
import {
  ProjectFormModal,
  type ProjectFormValues,
} from '@/components/project-form-modal';

type SortKey = 'code' | 'name' | 'status' | 'startDate' | 'contractAmount';

export default function ObrasPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectDto | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: 'code',
    dir: 1,
  });

  const query = useQuery({
    queryKey: ['projects', debouncedSearch, status],
    queryFn: () => projectsApi.list(debouncedSearch, status),
  });

  const saveMutation = useMutation({
    mutationFn: (values: ProjectFormValues) =>
      editing
        ? projectsApi.update(editing.id, values)
        : projectsApi.create(values),
    onSuccess: () => {
      toast(editing ? 'Obra actualizada' : 'Obra creada');
      qc.invalidateQueries({ queryKey: ['projects'] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => projectsApi.remove(id),
    onSuccess: () => {
      toast('Obra eliminada');
      qc.invalidateQueries({ queryKey: ['projects'] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast(err instanceof Error ? err.message : 'No se pudo eliminar', 'error');
      setDeleteTarget(null);
    },
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

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 },
    );

  const projects = query.data ?? [];

  const sorted = useMemo(() => {
    const arr = [...projects];
    arr.sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // los vacíos siempre al final
      if (vb === null) return -1;
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), 'es');
      return cmp * sort.dir;
    });
    return arr;
  }, [projects, sort]);

  const th = (label: string, key: SortKey, right = false) => (
    <SortableTh
      label={label}
      active={sort.key === key}
      dir={sort.dir}
      onClick={() => toggleSort(key)}
      right={right}
    />
  );

  return (
    <div className="animate-fade-in-up">
      <PageHeader title="Obras" count={projects.length}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por nombre o código…"
        />
        <select
          className={selectCls}
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
        <button onClick={openCreate} className={btnPrimaryCls}>
          <IconPlus size={15} />
          Nueva obra
        </button>
      </PageHeader>

      {query.isLoading && <TableSkeleton />}

      {query.isError && (
        <ErrorBanner message={(query.error as Error).message} />
      )}

      {query.isSuccess && projects.length === 0 && (
        <EmptyState
          icon={<IconBuilding size={26} />}
          title={
            search || status
              ? 'Ninguna obra coincide con el filtro'
              : 'Todavía no hay obras'
          }
        >
          {!search && !status && (
            <button onClick={openCreate} className={btnPrimaryCls}>
              <IconPlus size={15} />
              Crear la primera obra
            </button>
          )}
        </EmptyState>
      )}

      {projects.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                {th('Código', 'code')}
                {th('Nombre', 'name')}
                {th('Estado', 'status')}
                {th('Inicio', 'startDate')}
                {th('Contrato (sin IVA)', 'contractAmount', true)}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-gray-100 transition-colors last:border-0 hover:bg-amber-50/40"
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {p.code}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/obras/${p.id}`}
                      className="hover:text-amber-600 hover:underline"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatDate(p.startDate)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {formatEur(p.contractAmount)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(p)}
                        title="Editar"
                        className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                      >
                        <IconPencil size={15} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(p)}
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

      <ProjectFormModal
        open={modalOpen}
        project={editing}
        saving={saveMutation.isPending}
        error={(saveMutation.error as ApiError | null) ?? null}
        onSave={(values) => saveMutation.mutate(values)}
        onClose={closeModal}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`¿Eliminar la obra "${deleteTarget?.name ?? ''}"?`}
        description={`Código ${deleteTarget?.code ?? ''}. Podrás recuperarla más adelante: es un borrado lógico.`}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

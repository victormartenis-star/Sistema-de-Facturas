'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  CONTACT_KINDS,
  CONTACT_KIND_LABELS,
  type ContactDto,
  type ContactKind,
} from '@erp/shared';
import { ApiError, categoriesApi, contactsApi } from '@/lib/api';
import { useDebouncedValue } from '@/lib/hooks';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import {
  IconPencil,
  IconPlus,
  IconTrash,
  IconUsers,
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
  ContactFormModal,
  type ContactFormValues,
} from '@/components/contact-form-modal';

const KIND_STYLES: Record<ContactKind, string> = {
  proveedor: 'bg-sky-100 text-sky-700',
  cliente: 'bg-emerald-100 text-emerald-700',
  ambos: 'bg-violet-100 text-violet-700',
};

function KindBadge({ kind }: { kind: ContactKind }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${KIND_STYLES[kind]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {CONTACT_KIND_LABELS[kind]}
    </span>
  );
}

type SortKey = 'legalName' | 'taxId' | 'kind' | 'paymentTermsDays';

export default function ContactosPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [kind, setKind] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ContactDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactDto | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: 'legalName',
    dir: 1,
  });

  const query = useQuery({
    queryKey: ['contacts', debouncedSearch, kind],
    queryFn: () => contactsApi.list(debouncedSearch, kind),
  });

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.list,
    staleTime: 5 * 60_000,
  });

  const categoryName = (id: string | null) =>
    categoriesQuery.data?.find((c) => c.id === id)?.name ?? '—';

  const saveMutation = useMutation({
    mutationFn: (values: ContactFormValues) =>
      editing
        ? contactsApi.update(editing.id, values)
        : contactsApi.create(values),
    onSuccess: () => {
      toast(editing ? 'Contacto actualizado' : 'Contacto creado');
      qc.invalidateQueries({ queryKey: ['contacts'] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => contactsApi.remove(id),
    onSuccess: () => {
      toast('Contacto eliminado');
      qc.invalidateQueries({ queryKey: ['contacts'] });
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

  const openEdit = (c: ContactDto) => {
    setEditing(c);
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

  const contactsList = query.data ?? [];

  const sorted = useMemo(() => {
    const arr = [...contactsList];
    arr.sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), 'es');
      return cmp * sort.dir;
    });
    return arr;
  }, [contactsList, sort]);

  const th = (label: string, key: SortKey) => (
    <SortableTh
      label={label}
      active={sort.key === key}
      dir={sort.dir}
      onClick={() => toggleSort(key)}
    />
  );

  return (
    <div className="animate-fade-in-up">
      <PageHeader title="Contactos" count={contactsList.length}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por nombre o NIF…"
        />
        <select
          className={selectCls}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">Todos los tipos</option>
          {CONTACT_KINDS.map((k) => (
            <option key={k} value={k}>
              {CONTACT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <button onClick={openCreate} className={btnPrimaryCls}>
          <IconPlus size={15} />
          Nuevo contacto
        </button>
      </PageHeader>

      {query.isLoading && <TableSkeleton />}

      {query.isError && (
        <ErrorBanner message={(query.error as Error).message} />
      )}

      {query.isSuccess && contactsList.length === 0 && (
        <EmptyState
          icon={<IconUsers size={26} />}
          title={
            search || kind
              ? 'Ningún contacto coincide con el filtro'
              : 'Todavía no hay proveedores ni clientes'
          }
        >
          {!search && !kind && (
            <button onClick={openCreate} className={btnPrimaryCls}>
              <IconPlus size={15} />
              Crear el primer contacto
            </button>
          )}
        </EmptyState>
      )}

      {contactsList.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                {th('Razón social', 'legalName')}
                {th('NIF/CIF', 'taxId')}
                {th('Tipo', 'kind')}
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
                  Teléfono
                </th>
                {th('Pago', 'paymentTermsDays')}
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
                  Categoría habitual
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-gray-100 transition-colors last:border-0 hover:bg-amber-50/40"
                >
                  <td className="px-4 py-3 font-medium">
                    {c.legalName}
                    {c.tradeName && (
                      <span className="block text-xs font-normal text-gray-500">
                        {c.tradeName}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {c.taxId ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <KindBadge kind={c.kind} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">{c.email ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{c.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600 tabular-nums">
                    {c.paymentTermsDays} días
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {categoryName(c.defaultCategoryId)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(c)}
                        title="Editar"
                        className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                      >
                        <IconPencil size={15} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(c)}
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

      <ContactFormModal
        open={modalOpen}
        contact={editing}
        categories={categoriesQuery.data ?? []}
        saving={saveMutation.isPending}
        error={(saveMutation.error as ApiError | null) ?? null}
        onSave={(values) => saveMutation.mutate(values)}
        onClose={closeModal}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`¿Eliminar el contacto "${deleteTarget?.legalName ?? ''}"?`}
        description="Podrás recuperarlo más adelante: es un borrado lógico."
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

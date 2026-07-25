'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CONTACT_KINDS,
  CONTACT_KIND_LABELS,
  type ContactDto,
  type ContactKind,
} from '@erp/shared';
import { ApiError, categoriesApi, contactsApi } from '@/lib/api';
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
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${KIND_STYLES[kind]}`}
    >
      {CONTACT_KIND_LABELS[kind]}
    </span>
  );
}

export default function ContactosPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ContactDto | null>(null);

  const query = useQuery({
    queryKey: ['contacts', search, kind],
    queryFn: () => contactsApi.list(search, kind),
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
      qc.invalidateQueries({ queryKey: ['contacts'] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => contactsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
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

  const confirmDelete = (c: ContactDto) => {
    if (window.confirm(`¿Eliminar el contacto "${c.legalName}"?`)) {
      deleteMutation.mutate(c.id);
    }
  };

  const contactsList = query.data ?? [];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Contactos</h1>
        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
          {contactsList.length}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            className="w-56 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
            placeholder="Buscar por nombre o NIF…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
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
          <button
            onClick={openCreate}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
          >
            + Nuevo contacto
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

      {query.isSuccess && contactsList.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-16 text-center">
          <p className="text-4xl">👷</p>
          <p className="mt-3 font-medium text-gray-700">
            {search || kind
              ? 'Ningún contacto coincide con el filtro'
              : 'Todavía no hay proveedores ni clientes'}
          </p>
          {!search && !kind && (
            <button
              onClick={openCreate}
              className="mt-4 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
            >
              Crear el primer contacto
            </button>
          )}
        </div>
      )}

      {contactsList.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">Razón social</th>
                <th className="px-4 py-3 font-medium">NIF/CIF</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Teléfono</th>
                <th className="px-4 py-3 font-medium">Pago</th>
                <th className="px-4 py-3 font-medium">Categoría habitual</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {contactsList.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
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
                  <td className="px-4 py-3 text-gray-600">
                    {c.paymentTermsDays} días
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {categoryName(c.defaultCategoryId)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(c)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => confirmDelete(c)}
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

      <ContactFormModal
        open={modalOpen}
        contact={editing}
        categories={categoriesQuery.data ?? []}
        saving={saveMutation.isPending}
        error={(saveMutation.error as ApiError | null) ?? null}
        onSave={(values) => saveMutation.mutate(values)}
        onClose={closeModal}
      />
    </div>
  );
}

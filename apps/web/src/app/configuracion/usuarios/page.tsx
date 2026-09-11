'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  USER_ROLES,
  USER_ROLE_LABELS,
  type UserDto,
  type UserRole,
} from '@erp/shared';
import {
  ApiError,
  formatDate,
  projectsApi,
  usersApi,
} from '@/lib/api';
import { useToast } from '@/components/toast';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  EmptyState,
  ErrorBanner,
  Modal,
  PageHeader,
  TableSkeleton,
  btnPrimaryCls,
  btnGhostCls,
  inputCls,
  selectCls,
  labelCls,
  fieldCls,
} from '@/components/ui';
import {
  IconUsers,
  IconPencil,
  IconTrash,
  IconPlus,
  IconCheck,
  IconX,
} from '@/components/icons';

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-red-100 text-red-700',
  gerente: 'bg-violet-100 text-violet-700',
  administracion: 'bg-sky-100 text-sky-700',
  obra: 'bg-amber-100 text-amber-700',
};

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[role]}`}>
      {USER_ROLE_LABELS[role]}
    </span>
  );
}

// ── Modal nuevo usuario ─────────────────────────────────────────────────────
function NuevoUsuarioModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('administracion');

  const mutation = useMutation({
    mutationFn: () => usersApi.create({ email, fullName, password, role }),
    onSuccess: () => {
      toast('Usuario creado');
      setEmail(''); setFullName(''); setPassword(''); setRole('administracion');
      onSuccess();
      onClose();
    },
    onError: (e) => toast((e as ApiError).message ?? 'Error al crear usuario', 'error'),
  });

  return (
    <Modal open={open} title="Nuevo usuario" onClose={onClose}>
      <form
        onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
        className="space-y-4"
      >
        <div className={fieldCls}>
          <label className={labelCls}>Nombre completo</label>
          <input
            className={inputCls}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            placeholder="Ana García López"
          />
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Email</label>
          <input
            type="email"
            className={inputCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="ana@empresa.com"
          />
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Contraseña inicial</label>
          <input
            type="password"
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            placeholder="Mínimo 8 caracteres"
          />
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Rol</label>
          <select
            className={selectCls}
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
          >
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>{USER_ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className={btnGhostCls} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className={btnPrimaryCls}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Creando…' : 'Crear usuario'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Modal editar usuario ────────────────────────────────────────────────────
function EditarUsuarioModal({
  user,
  onClose,
  onSuccess,
}: {
  user: UserDto;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [fullName, setFullName] = useState(user.fullName);
  const [role, setRole] = useState<UserRole>(user.role);

  const mutation = useMutation({
    mutationFn: () => usersApi.update(user.id, { fullName, role }),
    onSuccess: () => {
      toast('Usuario actualizado');
      onSuccess();
      onClose();
    },
    onError: (e) => toast((e as ApiError).message ?? 'Error', 'error'),
  });

  return (
    <Modal open={true} title="Editar usuario" onClose={onClose}>
      <form
        onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
        className="space-y-4"
      >
        <div className={fieldCls}>
          <label className={labelCls}>Nombre completo</label>
          <input
            className={inputCls}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Rol</label>
          <select
            className={selectCls}
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
          >
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>{USER_ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <p className="text-xs text-gray-500">
          Email: <span className="font-mono">{user.email}</span> · Alta: {formatDate(user.createdAt.slice(0, 10))}
        </p>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className={btnGhostCls} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className={btnPrimaryCls} disabled={mutation.isPending}>
            {mutation.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Modal acceso a obras (rol obra) ────────────────────────────────────────
function AccesoObrasModal({
  user,
  onClose,
  onSuccess,
}: {
  user: UserDto;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
  });
  const accessQuery = useQuery({
    queryKey: ['user-access', user.id],
    queryFn: () => usersApi.listAccess(user.id),
  });

  const [selected, setSelected] = useState<Set<string> | null>(null);
  const effectiveSelected = selected ?? new Set(accessQuery.data ?? []);

  const mutation = useMutation({
    mutationFn: () => usersApi.setAccess(user.id, [...effectiveSelected]),
    onSuccess: () => {
      toast('Acceso actualizado');
      onSuccess();
      onClose();
    },
    onError: (e) => toast((e as ApiError).message ?? 'Error', 'error'),
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const s = new Set(prev ?? accessQuery.data ?? []);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  const projects = projectsQuery.data ?? [];

  return (
    <Modal open={true} title={`Obras accesibles — ${user.fullName}`} onClose={onClose} wide>
      <p className="mb-3 text-sm text-gray-500">
        Marca las obras que este usuario puede ver (solo aplica al rol <strong>Obra</strong>).
      </p>
      {accessQuery.isLoading || projectsQuery.isLoading ? (
        <TableSkeleton rows={4} />
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {projects.map((p) => {
            const checked = effectiveSelected.has(p.id);
            return (
              <li
                key={p.id}
                className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-gray-50"
                onClick={() => toggle(p.id)}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${
                    checked
                      ? 'border-amber-500 bg-amber-500 text-white'
                      : 'border-gray-300 bg-white'
                  }`}
                >
                  {checked && <IconCheck size={12} />}
                </span>
                <span className="flex-1 text-sm font-medium text-gray-800">{p.name}</span>
                <span className="text-xs text-gray-400">{p.code}</span>
              </li>
            );
          })}
          {projects.length === 0 && (
            <li className="py-8 text-center text-sm text-gray-500">Sin obras</li>
          )}
        </ul>
      )}
      <div className="flex justify-end gap-3 pt-4">
        <button className={btnGhostCls} onClick={onClose}>Cancelar</button>
        <button
          className={btnPrimaryCls}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Guardando…' : 'Guardar acceso'}
        </button>
      </div>
    </Modal>
  );
}

// ── Página principal ────────────────────────────────────────────────────────
export default function UsuariosPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [accessUser, setAccessUser] = useState<UserDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserDto | null>(null);

  const query = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (u: UserDto) => usersApi.update(u.id, { isActive: !u.isActive }),
    onSuccess: () => {
      toast('Estado actualizado');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast((e as ApiError).message ?? 'Error', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      toast('Usuario eliminado');
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast((e as ApiError).message ?? 'Error', 'error'),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });

  const userList = query.data ?? [];

  return (
    <div>
      <PageHeader
        title="Usuarios"
        subtitle="Gestión de accesos y roles del equipo"
        count={userList.length}
      >
        <button className={btnPrimaryCls} onClick={() => setCreateOpen(true)}>
          <IconPlus size={16} />
          Nuevo usuario
        </button>
      </PageHeader>

      {query.isError && (
        <ErrorBanner message={(query.error as Error).message} />
      )}

      {query.isLoading && <TableSkeleton rows={5} />}

      {!query.isLoading && !query.isError && userList.length === 0 && (
        <EmptyState icon={<IconUsers size={40} />} title="Sin usuarios">
          <p className="text-sm text-gray-500">
            Crea el primer usuario del equipo con el botón de arriba.
          </p>
        </EmptyState>
      )}

      {!query.isLoading && userList.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Nombre</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Rol</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Estado</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Alta</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {userList.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.fullName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{u.email}</td>
                  <td className="px-4 py-3">
                    <RoleBadge role={u.role} />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActiveMutation.mutate(u)}
                      disabled={toggleActiveMutation.isPending}
                      className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium transition ${
                        u.isActive
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {u.isActive ? <IconCheck size={11} /> : <IconX size={11} />}
                      {u.isActive ? 'Activo' : 'Inactivo'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDate(u.createdAt.slice(0, 10))}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {u.role === 'obra' && (
                        <button
                          onClick={() => setAccessUser(u)}
                          className="rounded px-2 py-1 text-xs text-sky-600 hover:bg-sky-50"
                          title="Gestionar acceso a obras"
                        >
                          Obras
                        </button>
                      )}
                      <button
                        onClick={() => setEditing(u)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        title="Editar"
                      >
                        <IconPencil size={15} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(u)}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        title="Eliminar"
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

      {/* Leyenda de roles */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Roles del sistema
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {USER_ROLES.map((r) => (
            <div key={r} className="flex items-start gap-2">
              <RoleBadge role={r} />
              <span className="text-xs text-gray-500 leading-5">
                {r === 'admin' && 'Acceso total'}
                {r === 'gerente' && 'Todas las obras, sin administrar usuarios'}
                {r === 'administracion' && 'Facturas, contactos y tesorería'}
                {r === 'obra' && 'Solo obras asignadas'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Modales */}
      <NuevoUsuarioModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={invalidate}
      />

      {editing && (
        <EditarUsuarioModal
          user={editing}
          onClose={() => setEditing(null)}
          onSuccess={invalidate}
        />
      )}

      {accessUser && (
        <AccesoObrasModal
          user={accessUser}
          onClose={() => setAccessUser(null)}
          onSuccess={invalidate}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="¿Eliminar usuario?"
        description={`Se eliminará ${deleteTarget?.fullName ?? ''} (${deleteTarget?.email ?? ''}). Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget!.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

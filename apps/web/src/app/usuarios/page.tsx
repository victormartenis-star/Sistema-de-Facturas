'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  PROJECT_ASSIGNMENT_LABELS,
  USER_ROLES,
  USER_ROLE_DESCRIPTIONS,
  USER_ROLE_LABELS,
  type UserDto,
  type UserRole,
} from '@erp/shared';
import { ApiError, authApi, formatDate } from '@/lib/api';
import { IconUsers } from '@/components/icons';
import { useToast } from '@/components/toast';
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

export default function UsuariosPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    email: '',
    fullName: '',
    role: 'jefe_obra' as UserRole,
    password: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ['usuarios'],
    queryFn: authApi.listUsers,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['usuarios'] });

  const create = useMutation({
    mutationFn: () => authApi.createUser(form),
    onSuccess: (u) => {
      toast(`${u.fullName} dado de alta como ${USER_ROLE_LABELS[u.role]}`);
      setCreating(false);
      setForm({ ...form, email: '', fullName: '', password: '' });
      invalidate();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length > 0) {
        setFieldErrors(
          Object.fromEntries(e.fieldErrors.map((f) => [f.field, f.message])),
        );
        return;
      }
      toast(errText(e), 'error');
    },
  });

  const toggleActive = useMutation({
    mutationFn: (u: UserDto) =>
      authApi.updateUser(u.id, { isActive: !u.isActive }),
    onSuccess: (u) => {
      // Desactivar surte efecto de inmediato: la guarda recarga el usuario en
      // cada petición y no espera a que caduque su token.
      toast(u.isActive ? 'Usuario reactivado' : 'Usuario desactivado');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const users = query.data ?? [];

  return (
    <div>
      <PageHeader
        title="Usuarios"
        subtitle="Los roles son los puestos del organigrama"
        count={users.length}
      >
        <button className={btnPrimaryCls} onClick={() => setCreating(true)}>
          Nuevo usuario
        </button>
      </PageHeader>

      {query.isError && <ErrorBanner message={errText(query.error)} />}
      {query.isLoading && <TableSkeleton rows={4} />}

      {query.isSuccess && users.length === 0 && (
        <EmptyState icon={<IconUsers size={26} />} title="No hay usuarios" />
      )}

      {users.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Puesto</th>
                <th className="px-4 py-3 font-medium">Obras asignadas</th>
                <th className="px-4 py-3 font-medium">Último acceso</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className={`border-b border-gray-100 last:border-0 ${
                    u.isActive ? '' : 'opacity-50'
                  }`}
                >
                  <td className="px-4 py-3 font-medium">
                    {u.fullName}
                    {!u.isActive && (
                      <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                        DESACTIVADO
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3">{USER_ROLE_LABELS[u.role]}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {u.projects.length === 0 ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      u.projects
                        .map(
                          (p) =>
                            `${p.code} (${PROJECT_ASSIGNMENT_LABELS[p.as]})`,
                        )
                        .join(', ')
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {u.lastLoginAt
                      ? formatDate(u.lastLoginAt.slice(0, 10))
                      : 'Nunca'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className="text-xs text-gray-500 hover:text-gray-900"
                      onClick={() => toggleActive.mutate(u)}
                    >
                      {u.isActive ? 'Desactivar' : 'Reactivar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-500">
        Las obras asignadas salen de los responsables de cada obra. Un Jefe de
        Obra o un Encargado solo ve aquellas en las que figura por escrito.
      </p>

      <Modal
        open={creating}
        title="Nuevo usuario"
        onClose={() => setCreating(false)}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setFieldErrors({});
            create.mutate();
          }}
        >
          <div>
            <label className={labelCls}>Nombre y apellidos</label>
            <input
              className={fieldCls}
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              required
            />
            {fieldErrors.fullName && (
              <p className="mt-1 text-xs text-red-600">
                {fieldErrors.fullName}
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input
              type="email"
              className={fieldCls}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
            {fieldErrors.email && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>
            )}
          </div>
          <div>
            <label className={labelCls}>Puesto</label>
            <select
              className={selectCls}
              value={form.role}
              onChange={(e) =>
                setForm({ ...form, role: e.target.value as UserRole })
              }
            >
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {USER_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              {USER_ROLE_DESCRIPTIONS[form.role]}
            </p>
          </div>
          <div>
            <label className={labelCls}>Contraseña inicial</label>
            <input
              type="text"
              className={fieldCls}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Mínimo 10 caracteres"
              required
            />
            {fieldErrors.password && (
              <p className="mt-1 text-xs text-red-600">
                {fieldErrors.password}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className={btnGhostCls}
              onClick={() => setCreating(false)}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={create.isPending}
            >
              {create.isPending ? 'Creando…' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, authApi } from '@/lib/api';
import { saveSession } from '@/lib/session';
import { btnPrimaryCls, fieldCls, labelCls } from '@/components/ui';

export default function AccesoPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: () => authApi.login({ email, password }),
    onSuccess: (session) => {
      saveSession(session);
      // Recarga completa: así el resto de la aplicación arranca ya con la
      // sesión cargada y las capacidades aplicadas al menú.
      window.location.href = '/';
    },
  });

  return (
    <div className="mx-auto mt-20 max-w-sm">
      <div className="mb-8 flex flex-col items-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500 text-lg font-bold text-white">
          SF
        </span>
        <h1 className="mt-3 text-xl font-bold">Sistema de Facturas</h1>
        <p className="text-sm text-gray-500">
          ERP de gestión para construcción
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
        className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <div>
          <label className={labelCls} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            className={fieldCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div>
          <label className={labelCls} htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className={fieldCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {login.isError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {(login.error as ApiError).message}
          </p>
        )}

        <button
          type="submit"
          disabled={login.isPending}
          className={`${btnPrimaryCls} w-full justify-center`}
          onClick={() => router.prefetch('/')}
        >
          {login.isPending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

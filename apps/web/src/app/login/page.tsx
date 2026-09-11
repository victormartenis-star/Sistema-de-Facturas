'use client';

import { FormEvent, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  Auth0Button,
  AuthCard,
  AuthField,
  AuthForm,
  AuthSubmit,
  AuthSwitchLink,
} from '@/components/auth-ui';
import { ErrorBanner } from '@/components/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo iniciar sesión. Revisa la API.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="Iniciar sesión"
      subtitle="Accede al ERP Dintel con tu cuenta de empresa"
      footer={
        <AuthSwitchLink
          prompt="¿Primera vez?"
          href="/registro"
          label="Crear cuenta"
        />
      }
    >
      <AuthForm onSubmit={onSubmit}>
        {error && <ErrorBanner message={error} />}
        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
        />
        <AuthField
          id="password"
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        <AuthSubmit loading={loading}>Entrar</AuthSubmit>
      </AuthForm>

      <div className="my-5 flex items-center gap-3 text-xs text-gray-400">
        <span className="h-px flex-1 bg-gray-200" />
        o
        <span className="h-px flex-1 bg-gray-200" />
      </div>
      <Auth0Button />
    </AuthCard>
  );
}

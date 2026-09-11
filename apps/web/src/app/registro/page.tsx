'use client';

import { FormEvent, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  AuthCard,
  AuthField,
  AuthForm,
  AuthSubmit,
  AuthSwitchLink,
} from '@/components/auth-ui';
import { ErrorBanner } from '@/components/ui';

export default function RegisterPage() {
  const { register } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register({ email, password, fullName });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo completar el registro.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="Crear cuenta"
      subtitle="El primer usuario de la empresa será administrador"
      footer={
        <AuthSwitchLink
          prompt="¿Ya tienes cuenta?"
          href="/login"
          label="Iniciar sesión"
        />
      }
    >
      <AuthForm onSubmit={onSubmit}>
        {error && <ErrorBanner message={error} />}
        <AuthField
          id="fullName"
          label="Nombre completo"
          autoComplete="name"
          value={fullName}
          onChange={setFullName}
        />
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
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={setPassword}
        />
        <p className="text-xs text-gray-500">Mínimo 8 caracteres.</p>
        <AuthSubmit loading={loading}>Registrarme</AuthSubmit>
      </AuthForm>
    </AuthCard>
  );
}

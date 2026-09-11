'use client';

import Link from 'next/link';
import type { FormEvent, ReactNode } from 'react';
import { btnPrimaryCls, inputCls } from '@/components/ui';

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#fde68a55,_transparent_55%),linear-gradient(160deg,#0f172a_0%,#1e293b_45%,#334155_100%)]"
      />
      <div className="relative w-full max-w-md animate-fade-in-up">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-lg font-bold text-white shadow-lg shadow-amber-500/30">
            SF
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {title}
          </h1>
          <p className="mt-2 text-sm text-slate-300">{subtitle}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white p-6 shadow-2xl shadow-black/20 sm:p-8">
          {children}
        </div>
        {footer && (
          <p className="mt-6 text-center text-sm text-slate-300">{footer}</p>
        )}
      </div>
    </div>
  );
}

export function AuthField({
  label,
  id,
  type = 'text',
  autoComplete,
  value,
  onChange,
  required = true,
  minLength,
}: {
  label: string;
  id: string;
  type?: string;
  autoComplete?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        className={`${inputCls} w-full`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function AuthSubmit({
  loading,
  children,
}: {
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className={`${btnPrimaryCls} w-full justify-center py-2.5 disabled:opacity-60`}
    >
      {loading ? 'Espera…' : children}
    </button>
  );
}

export function AuthForm({
  onSubmit,
  children,
}: {
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {children}
    </form>
  );
}

export function AuthSwitchLink({
  prompt,
  href,
  label,
}: {
  prompt: string;
  href: string;
  label: string;
}) {
  return (
    <>
      {prompt}{' '}
      <Link href={href} className="font-semibold text-amber-300 hover:underline">
        {label}
      </Link>
    </>
  );
}

/** Auth0 Universal Login cuando hay dominio + client id públicos. */
export function Auth0Button() {
  const domain = process.env.NEXT_PUBLIC_AUTH0_DOMAIN;
  const clientId = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID;
  const audience = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;

  if (!domain || !clientId) {
    return (
      <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-center text-xs text-gray-500">
        Auth0 opcional: define{' '}
        <code className="text-[11px]">NEXT_PUBLIC_AUTH0_DOMAIN</code> y{' '}
        <code className="text-[11px]">NEXT_PUBLIC_AUTH0_CLIENT_ID</code>
      </p>
    );
  }

  const redirectUri =
    typeof window !== 'undefined'
      ? `${window.location.origin}/login/callback`
      : '';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    ...(audience ? { audience } : {}),
  });
  const href = `https://${domain}/authorize?${params}`;

  return (
    <a
      href={href}
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
    >
      Continuar con Auth0
    </a>
  );
}

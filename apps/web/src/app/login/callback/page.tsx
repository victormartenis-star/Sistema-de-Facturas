'use client';

/** Placeholder Auth0 Authorization Code + PKCE (backend callback pendiente). */
export default function Auth0CallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4 text-center text-sm text-slate-300">
      <div className="max-w-md space-y-2">
        <p className="text-lg font-semibold text-white">Callback Auth0</p>
        <p>
          El intercambio del código por JWT Auth0 en el backend NestJS aún no
          está cableado. Usa login email/contraseña mientras tanto.
        </p>
        <a href="/login" className="inline-block font-semibold text-amber-300">
          Volver al login
        </a>
      </div>
    </div>
  );
}

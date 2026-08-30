import type { Capability, SessionDto, UserDto } from '@erp/shared';

/**
 * Sesión del navegador.
 *
 * Se guarda en `localStorage` a propósito y no en una cookie: la API y la web
 * son dos orígenes distintos y el token viaja en la cabecera `Authorization`,
 * así que no hay nada que enviar automáticamente. La contrapartida conocida
 * es que un XSS podría leerlo; la mitigación real es no inyectar HTML de
 * terceros, que es la política de todas las pantallas.
 */
const KEY = 'erp.session';

export interface StoredSession {
  token: string;
  user: UserDto;
  capabilities: Capability[];
}

export function saveSession(session: SessionDto): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function loadSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (typeof window !== 'undefined') localStorage.removeItem(KEY);
}

export function sessionToken(): string | null {
  return loadSession()?.token ?? null;
}

/**
 * Comprobación de capacidad en la interfaz.
 *
 * Ocultar un enlace es una comodidad, no una medida de seguridad: el permiso
 * de verdad lo aplica la API, que deniega por defecto. Aquí solo se evita que
 * alguien entre en una pantalla donde solo iba a encontrarse un 403.
 */
export function hasCapability(capability: Capability): boolean {
  return loadSession()?.capabilities.includes(capability) ?? false;
}

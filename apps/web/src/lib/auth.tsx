'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { AuthTokensDto, UserDto } from '@erp/shared';
import { authApi, clearStoredSession, readStoredSession, writeStoredSession } from '@/lib/api';

interface AuthContextValue {
  user: UserDto | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    fullName: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  applyTokens: (tokens: AuthTokensDto) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const PUBLIC_PATHS = ['/login', '/registro'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserDto | null>(null);
  const [ready, setReady] = useState(false);

  const applyTokens = useCallback((tokens: AuthTokensDto) => {
    writeStoredSession(tokens);
    setUser(tokens.user);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = readStoredSession();
      if (!session?.accessToken) {
        if (!cancelled) {
          setUser(null);
          setReady(true);
        }
        return;
      }
      try {
        const me = await authApi.me();
        if (!cancelled) setUser(me);
      } catch {
        clearStoredSession();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const isPublic = PUBLIC_PATHS.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
    if (!user && !isPublic) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (user && isPublic) {
      router.replace('/');
    }
  }, [ready, user, pathname, router]);

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await authApi.login({ email, password });
      applyTokens(tokens);
      router.replace('/');
    },
    [applyTokens, router],
  );

  const register = useCallback(
    async (input: { email: string; password: string; fullName: string }) => {
      const tokens = await authApi.register(input);
      applyTokens(tokens);
      router.replace('/');
    },
    [applyTokens, router],
  );

  const logout = useCallback(async () => {
    const session = readStoredSession();
    try {
      if (session?.refreshToken) {
        await authApi.logout(session.refreshToken);
      }
    } catch {
      // cerrar sesión local aunque falle la revocación
    }
    clearStoredSession();
    setUser(null);
    router.replace('/login');
  }, [router]);

  const value = useMemo(
    () => ({ user, ready, login, register, logout, applyTokens }),
    [user, ready, login, register, logout, applyTokens],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }
  return ctx;
}

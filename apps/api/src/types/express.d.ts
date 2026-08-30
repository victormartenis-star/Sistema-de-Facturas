import type { AuthUser } from '../auth/auth.decorators';

declare global {
  namespace Express {
    interface Request {
      /** Usuario autenticado que deja la guarda global en cada petición. */
      user?: AuthUser;
    }
  }
}

export {};

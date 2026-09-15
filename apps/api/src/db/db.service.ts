import {
  Injectable,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  closeDb,
  companies,
  Db,
  getDb,
  userProjectAccess,
  users,
} from '@erp/db';
import { getRequestContext } from '../common/request-context';

@Injectable()
export class DbService implements OnModuleDestroy {
  private defaultCompanyId: string | null = null;

  get db(): Db {
    return getDb();
  }

  /**
   * `company_id` del usuario autenticado en la petición actual, publicado por
   * `RequestContextInterceptor` a partir del JWT que valida `JwtAuthGuard`.
   * Úsala en cualquier servicio detrás de un endpoint protegido.
   */
  getCompanyId(): string {
    const ctx = getRequestContext();
    if (!ctx) {
      throw new UnauthorizedException(
        'No hay usuario autenticado en el contexto de la petición',
      );
    }
    return ctx.companyId;
  }

  /**
   * Devuelve el contexto completo de la petición actual.
   * Lanza 401 si no hay usuario autenticado.
   */
  getContext() {
    const ctx = getRequestContext();
    if (!ctx) {
      throw new UnauthorizedException(
        'No hay usuario autenticado en el contexto de la petición',
      );
    }
    return ctx;
  }

  /**
   * Para los roles `obra` y `cliente` (Fase 14, portal de clientes de solo
   * lectura), devuelve los projectIds a los que el usuario tiene acceso
   * explícito. Para los demás roles devuelve `null` (sin restricción).
   *
   * Uso en servicios:
   * ```ts
   * const allowed = await this.dbs.getObrasAccesibles();
   * if (allowed !== null) {
   *   filters.push(inArray(table.projectId, allowed));
   * }
   * ```
   */
  async getObrasAccesibles(): Promise<string[] | null> {
    const ctx = this.getContext();
    if (ctx.role !== 'obra' && ctx.role !== 'cliente') return null;
    const rows = await this.db
      .select({ projectId: userProjectAccess.projectId })
      .from(userProjectAccess)
      .where(eq(userProjectAccess.userId, ctx.userId));
    return rows.map((r) => r.projectId);
  }

  /**
   * Para el rol `subcontrata` (Fase 14, portal de subcontratas), el
   * contacto que representa el usuario autenticado. Lanza si el usuario no
   * tiene un contacto asignado (alta a medias) — sin contacto el portal no
   * tiene nada que mostrar.
   */
  async getContactId(): Promise<string> {
    const ctx = this.getContext();
    const [row] = await this.db
      .select({ contactId: users.contactId })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);
    if (!row?.contactId) {
      throw new UnauthorizedException(
        'Este usuario de portal no tiene una subcontrata asignada',
      );
    }
    return row.contactId;
  }

  /**
   * Bootstrap monoempresa: la única empresa existente (creada por el seed).
   * Solo para lo que ocurre *antes* de tener un usuario autenticado (alta de
   * la primera cuenta) o fuera de una petición HTTP (worker de OCR). El resto
   * del código usa `getCompanyId()`.
   */
  async getDefaultCompanyId(): Promise<string> {
    if (this.defaultCompanyId) return this.defaultCompanyId;
    const [company] = await this.db.select().from(companies).limit(1);
    if (!company) {
      throw new Error(
        'No hay ninguna empresa en la base de datos. Ejecuta: npm run db:seed',
      );
    }
    this.defaultCompanyId = company.id;
    return company.id;
  }

  async onModuleDestroy() {
    await closeDb();
  }
}

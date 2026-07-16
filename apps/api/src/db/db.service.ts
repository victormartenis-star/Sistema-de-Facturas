import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { closeDb, companies, Db, getDb } from '@erp/db';

@Injectable()
export class DbService implements OnModuleDestroy {
  private defaultCompanyId: string | null = null;

  get db(): Db {
    return getDb();
  }

  /**
   * MVP monoempresa: todas las operaciones cuelgan de la única empresa
   * existente (creada por el seed). Cuando llegue la autenticación, el
   * company_id vendrá del usuario autenticado.
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

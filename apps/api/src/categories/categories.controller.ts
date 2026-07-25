import { Controller, Get } from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';
import { categories } from '@erp/db';
import { CategoryDto } from '@erp/shared';
import { DbService } from '../db/db.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly dbs: DbService) {}

  /** Las categorías de sistema primero, luego las personalizadas por nombre. */
  @Get()
  async list(): Promise<CategoryDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const rows = await this.dbs.db
      .select()
      .from(categories)
      .where(eq(categories.companyId, companyId))
      .orderBy(desc(categories.isSystem), asc(categories.createdAt));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      parentId: r.parentId,
      isSystem: r.isSystem,
    }));
  }
}

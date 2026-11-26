import { and, eq, sql } from 'drizzle-orm';
import { retentionReleases, type DbOrTx } from '@erp/db';

/**
 * Importe de retenciones que un aval sustituye (liberaciones vigentes por
 * aval). Sin inyección de dependencias: lo usan avales y Project System sin
 * dependencias circulares entre módulos.
 */
export async function sustituidoPorAval(
  ex: DbOrTx,
  avalId: string,
): Promise<string> {
  const [r] = await ex
    .select({
      total: sql<string>`coalesce(sum(${retentionReleases.amount}), 0)::text`,
    })
    .from(retentionReleases)
    .where(
      and(
        eq(retentionReleases.guaranteeId, avalId),
        eq(retentionReleases.status, 'vigente'),
      ),
    );
  return r?.total ?? '0';
}

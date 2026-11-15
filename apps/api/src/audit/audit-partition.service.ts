import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { getDb } from '@erp/db';

/**
 * `audit_log` está particionada por mes desde la Fase 16 (ver
 * `packages/db/drizzle/0027_audit_log_partition.sql`) sin `pg_partman` —
 * no disponible en este entorno (comprobado con
 * `SELECT * FROM pg_available_extensions`) — así que el alta de
 * particiones futuras la hace este cron, no una extensión externa.
 *
 * Corre a diario con un margen de `MONTHS_AHEAD` meses por delante: mucho
 * más frecuente de lo estrictamente necesario, pero cada pasada es barata
 * (un `to_regclass` por mes en rango, como mucho un `CREATE TABLE` si
 * falta alguna) y evita depender de que alguien lo dispare a mano antes de
 * fin de mes. `ensurePartitions()` es idempotente: repetirla no falla ni
 * duplica nada.
 */
@Injectable()
export class AuditPartitionService {
  private readonly logger = new Logger(AuditPartitionService.name);
  private static readonly MONTHS_AHEAD = 2;

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleCron(): Promise<void> {
    const created = await this.ensurePartitions();
    if (created.length > 0) {
      this.logger.log(
        `Particiones de audit_log creadas: ${created.join(', ')}.`,
      );
    }
  }

  /**
   * Crea las particiones mensuales de `audit_log` que falten desde el mes
   * actual hasta `MONTHS_AHEAD` meses vista. Devuelve los nombres de las
   * que sí ha tenido que crear (vacío si ya estaban todas).
   */
  async ensurePartitions(): Promise<string[]> {
    const db = getDb();
    const created: string[] = [];
    const now = new Date();

    for (let i = 0; i <= AuditPartitionService.MONTHS_AHEAD; i++) {
      const monthStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1),
      );
      const monthEnd = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 1),
      );
      const startIso = monthStart.toISOString().slice(0, 10);
      const endIso = monthEnd.toISOString().slice(0, 10);
      const partitionName = `audit_log_${startIso.slice(0, 4)}_${startIso.slice(5, 7)}`;

      const existsResult = await db.execute(
        sql`select to_regclass(${`public.${partitionName}`}) is not null as exists`,
      );
      const exists = Boolean(
        (existsResult.rows[0] as { exists: boolean }).exists,
      );
      if (exists) continue;

      // Nombre y fechas generados por esta función, nunca por el usuario:
      // sql.raw() es seguro aquí porque no hay entrada externa que alcance
      // esta ruta (cron interno, sin parámetros).
      await db.execute(
        sql.raw(
          `create table "${partitionName}" partition of audit_log for values from ('${startIso}') to ('${endIso}')`,
        ),
      );
      // Los triggers de fila se clonan solos desde el padre; los de sentencia
      // (TRUNCATE) no: hay que crearlo en cada partición nueva.
      await db.execute(
        sql.raw(
          `create trigger audit_log_bt_truncate before truncate on "${partitionName}" for each statement execute function audit_bloquear_truncate()`,
        ),
      );
      created.push(partitionName);
    }
    return created;
  }
}

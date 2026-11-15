import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, desc, eq, lt } from 'drizzle-orm';
import { auditAnchors, auditChainHeads, auditLog, getDb } from '@erp/db';

const DIA_MS = 24 * 60 * 60 * 1000;

/** El cron se omite con `NODE_ENV=test` o `DESACTIVAR_CRON=true` (se lee en cada ejecución). */
export function cronAnclajeActivo(): boolean {
  return (
    process.env.NODE_ENV !== 'test' && process.env.DESACTIVAR_CRON !== 'true'
  );
}

export interface ResultadoAnclaje {
  fecha: string;
  creadas: number;
  existentes: number;
}

/**
 * Ancla diaria de la cadena hash de auditoría: guarda, por empresa y día UTC,
 * el último `sequence_number`/`entry_hash` con `occurred_at` anterior al fin
 * de ese día. Las anclas son inmutables (triggers de la migración 0042) y
 * `AuditIntegrityService` las contrasta con la cadena.
 *
 * LIMITACIÓN: las anclas viven en la misma base de datos. Quien pueda hacer
 * DDL y reescriba cadena y anclas a la vez no se detecta; el anclaje externo
 * (sellado de tiempo, almacenamiento WORM) queda fuera de alcance.
 */
@Injectable()
export class AuditAnchorService {
  private readonly logger = new Logger(AuditAnchorService.name);

  /** 02:15 UTC: cierra el día UTC anterior. */
  @Cron('15 2 * * *', { timeZone: 'UTC' })
  async handleCron(): Promise<void> {
    if (!cronAnclajeActivo()) return;
    const ayer = new Date(Date.now() - DIA_MS).toISOString().slice(0, 10);
    try {
      await this.anclarDia(ayer);
    } catch (e) {
      this.logger.error(`Fallo al anclar la cadena de auditoría: ${String(e)}`);
    }
  }

  /** Ancla el día UTC actual con el estado de la cadena en este momento. */
  anclarAhora(): Promise<ResultadoAnclaje> {
    return this.anclarDia(new Date().toISOString().slice(0, 10));
  }

  /** Idempotente: no toca las anclas ya existentes de (empresa, fecha). */
  async anclarDia(fecha: string): Promise<ResultadoAnclaje> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) {
      throw new Error(`Fecha de anclaje no válida: ${fecha}`);
    }
    const limite = new Date(Date.parse(`${fecha}T00:00:00.000Z`) + DIA_MS);
    const resultado: ResultadoAnclaje = { fecha, creadas: 0, existentes: 0 };

    await getDb().transaction(async (tx) => {
      // Bloqueo compartido de las cabeceras: lectura coherente sin escrituras
      // de auditoría concurrentes durante el anclaje.
      const cabeceras = await tx
        .select({ companyId: auditChainHeads.companyId })
        .from(auditChainHeads)
        .for('share');
      for (const { companyId } of cabeceras) {
        const [previa] = await tx
          .select({ id: auditAnchors.id })
          .from(auditAnchors)
          .where(
            and(
              eq(auditAnchors.companyId, companyId),
              eq(auditAnchors.anchorDate, fecha),
            ),
          );
        if (previa) {
          resultado.existentes++;
          continue;
        }
        const [ultima] = await tx
          .select({
            sequenceNumber: auditLog.sequenceNumber,
            entryHash: auditLog.entryHash,
          })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.companyId, companyId),
              lt(auditLog.occurredAt, limite),
            ),
          )
          .orderBy(desc(auditLog.sequenceNumber))
          .limit(1);
        if (!ultima?.entryHash) continue;
        const insertadas = await tx
          .insert(auditAnchors)
          .values({
            companyId,
            anchorDate: fecha,
            sequenceNumber: ultima.sequenceNumber,
            entryHash: ultima.entryHash,
          })
          .onConflictDoNothing()
          .returning({ id: auditAnchors.id });
        if (insertadas.length > 0) resultado.creadas++;
      }
    });

    this.logger.log(JSON.stringify({ msg: 'audit.anchor.done', ...resultado }));
    return resultado;
  }
}

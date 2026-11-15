import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { empresasPendientesDeSellar, sellarLegado } from './audit-chain';
import { DbService } from '../db/db.service';

/** Sella al arrancar las filas históricas de `audit_log` pendientes de hash. */
@Injectable()
export class AuditChainBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuditChainBackfillService.name);

  constructor(private readonly dbs: DbService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const sellados = await this.sellarPendientes();
      if (sellados > 0) {
        this.logger.log(`Auditoría histórica sellada: ${sellados} entradas.`);
      }
    } catch (err) {
      // El arranque no debe caer por esto: `registrar()` sella en línea la
      // primera vez que escriba en una empresa pendiente.
      this.logger.error(
        `No se pudo sellar la auditoría histórica: ${(err as Error).message}`,
      );
    }
  }

  /** Sella todas las empresas pendientes. Devuelve el total de filas selladas. */
  async sellarPendientes(): Promise<number> {
    const empresas = await empresasPendientesDeSellar(this.dbs.db);
    let total = 0;
    for (const companyId of empresas) {
      total += await this.dbs.db.transaction((tx) =>
        sellarLegado(tx, companyId),
      );
    }
    return total;
  }
}

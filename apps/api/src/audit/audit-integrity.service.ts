import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import { auditChainHeads, AuditLogEntry, auditLog } from '@erp/db';
import {
  AUDIT_GENESIS_HASH,
  AUDIT_HASH_VERSION,
  AuditIntegrityBreakDto,
  AuditIntegrityMotivo,
  AuditIntegrityReportDto,
} from '@erp/shared';
import { DbService } from '../db/db.service';
import { calcularHashAuditoria, entradaDeFila } from './audit-chain';

const LOTE_VERIFICACION = 2000;

/**
 * Recorre la cadena de auditoría de la empresa y devuelve el PRIMER punto
 * roto (si lo hay). Siempre devuelve un informe: el veredicto va en `integra`.
 */
@Injectable()
export class AuditIntegrityService {
  private readonly logger = new Logger(AuditIntegrityService.name);

  constructor(private readonly dbs: DbService) {}

  async verificar(companyId?: string): Promise<AuditIntegrityReportDto> {
    const empresa = companyId ?? this.dbs.getCompanyId();
    const inicio = Date.now();

    const informe = await this.dbs.db.transaction(
      async (tx) => {
        const [cabecera] = await tx
          .select()
          .from(auditChainHeads)
          .where(eq(auditChainHeads.companyId, empresa));

        let esperado = 1;
        let hashPrevio = AUDIT_GENESIS_HASH;
        let verificadas = 0;
        let roto: AuditIntegrityBreakDto | null = null;
        let hayFilas = false;
        let cursor: number | null = null;

        const romper = (
          fila: { id: string; sequenceNumber: number; occurredAt: Date },
          motivo: AuditIntegrityMotivo,
          detalle: string,
          exp: string | null,
          enc: string | null,
        ): AuditIntegrityBreakDto => ({
          id: fila.id,
          sequenceNumber: fila.sequenceNumber,
          occurredAt: fila.occurredAt.toISOString(),
          motivo,
          detalle,
          esperado: exp,
          encontrado: enc,
        });

        recorrido: for (;;) {
          const lote: AuditLogEntry[] = await tx
            .select()
            .from(auditLog)
            .where(
              cursor !== null
                ? and(
                    eq(auditLog.companyId, empresa),
                    gt(auditLog.sequenceNumber, cursor),
                  )
                : eq(auditLog.companyId, empresa),
            )
            .orderBy(
              asc(auditLog.sequenceNumber),
              asc(auditLog.occurredAt),
              asc(auditLog.id),
            )
            .limit(LOTE_VERIFICACION);
          if (lote.length === 0) break;
          // El cursor es solo `sequence_number`: un lote lleno no puede cortar un
          // grupo de números repetidos (se recortan sus últimas filas).
          if (lote.length === LOTE_VERIFICACION) {
            const ultimoSeq = lote[lote.length - 1].sequenceNumber;
            const corte = lote.findIndex((f) => f.sequenceNumber === ultimoSeq);
            if (corte > 0) lote.length = corte;
          }
          hayFilas = true;

          for (const fila of lote) {
            const n = fila.sequenceNumber;
            if (n < esperado) {
              roto = romper(
                fila,
                'SEQUENCE_DUPLICATE',
                'Número de secuencia repetido',
                String(esperado),
                String(n),
              );
            } else if (n > esperado) {
              roto = romper(
                fila,
                'SEQUENCE_GAP',
                'Faltan entradas en la secuencia',
                String(esperado),
                String(n),
              );
            } else if (fila.entryHash === null) {
              roto = romper(
                fila,
                'UNSEALED',
                'La entrada no está sellada (sin hash)',
                null,
                null,
              );
            } else if (fila.hashVersion !== AUDIT_HASH_VERSION) {
              roto = romper(
                fila,
                'HASH_VERSION_UNSUPPORTED',
                'Versión de hash no soportada',
                String(AUDIT_HASH_VERSION),
                String(fila.hashVersion),
              );
            } else if (fila.previousHash !== hashPrevio) {
              roto = romper(
                fila,
                'PREVIOUS_HASH_MISMATCH',
                'previous_hash no coincide con el entry_hash de la entrada anterior',
                hashPrevio,
                fila.previousHash,
              );
            } else {
              const recalculado = calcularHashAuditoria(
                entradaDeFila(fila, hashPrevio),
              );
              if (recalculado !== fila.entryHash) {
                roto = romper(
                  fila,
                  'ENTRY_HASH_MISMATCH',
                  'El hash recalculado no coincide con entry_hash',
                  recalculado,
                  fila.entryHash,
                );
              }
            }
            if (roto) break recorrido;
            esperado++;
            verificadas++;
            hashPrevio = fila.entryHash as string;
          }
          const ultima = lote[lote.length - 1];
          cursor = ultima.sequenceNumber;
        }

        if (!roto) {
          if (hayFilas && !cabecera) {
            roto = {
              id: null,
              sequenceNumber: 0,
              occurredAt: null,
              motivo: 'HEAD_MISSING',
              detalle: 'Hay entradas pero no existe la cabecera de la cadena',
              esperado: String(esperado - 1),
              encontrado: null,
            };
          } else if (
            cabecera &&
            (cabecera.lastSequenceNumber !== esperado - 1 ||
              cabecera.lastEntryHash !== hashPrevio)
          ) {
            roto = {
              id: null,
              sequenceNumber: cabecera.lastSequenceNumber,
              occurredAt: null,
              motivo: 'HEAD_MISMATCH',
              detalle:
                'La cabecera no coincide con el final de la cadena (cola truncada o cabecera alterada)',
              esperado: `${esperado - 1}:${hashPrevio}`,
              encontrado: `${cabecera.lastSequenceNumber}:${cabecera.lastEntryHash}`,
            };
          }
        }

        return { roto, verificadas, hashPrevio };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );

    const resultado: AuditIntegrityReportDto = {
      companyId: empresa,
      integra: informe.roto === null,
      entradasVerificadas: informe.verificadas,
      ultimaSecuencia: informe.verificadas,
      ultimoHash: informe.hashPrevio,
      verificadoEn: new Date().toISOString(),
      duracionMs: Date.now() - inicio,
      primerPuntoRoto: informe.roto,
    };
    this.logger.log(
      JSON.stringify({
        msg: 'audit.integrity.verified',
        companyId: empresa,
        integra: resultado.integra,
        entradasVerificadas: resultado.entradasVerificadas,
        motivo: informe.roto?.motivo ?? null,
        duracionMs: resultado.duracionMs,
      }),
    );
    return resultado;
  }
}

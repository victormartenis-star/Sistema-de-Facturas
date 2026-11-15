import { createHmac, timingSafeEqual } from 'node:crypto';
import { jsonCanonico } from '@erp/shared';
import type { AuditAnclaFirmable } from '@erp/shared';

/**
 * Firma HMAC-SHA256 de las anclas de auditoría. Módulo puro: no toca la base
 * de datos ni `audit_chain_heads`; una ancla (p. ej. leída de la exportación
 * externa) y la clave bastan para verificarla.
 *
 * SIMULACIÓN: HMAC con clave simétrica en el entorno. Quien tenga la clave
 * puede fabricar anclas válidas; no es una firma asimétrica ni un sellado de
 * tiempo cualificado.
 */

export const AUDIT_ANCHOR_KEY_MIN = 32;

/** Clave de firma del entorno, o null si no está definida o es demasiado corta. */
export function claveAnclaje(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const clave = env.AUDIT_ANCHOR_KEY;
  if (!clave) return null;
  if (clave.length < AUDIT_ANCHOR_KEY_MIN) {
    throw new Error(
      `AUDIT_ANCHOR_KEY debe tener al menos ${AUDIT_ANCHOR_KEY_MIN} caracteres`,
    );
  }
  return clave;
}

/** Payload canónico firmado: empresa, fecha, secuencia, hash y versión de hash. */
export function payloadFirmaAncla(a: AuditAnclaFirmable): string {
  return jsonCanonico({
    anchorDate: a.anchorDate,
    companyId: a.companyId,
    entryHash: a.entryHash,
    hashVersion: a.hashVersion,
    sequenceNumber: a.sequenceNumber,
  });
}

export function firmarAncla(a: AuditAnclaFirmable, clave: string): string {
  return createHmac('sha256', clave)
    .update(payloadFirmaAncla(a), 'utf8')
    .digest('hex');
}

/** Recalcula la firma y la compara en tiempo constante. No accede a la BD. */
export function verificarFirmaAncla(
  ancla: AuditAnclaFirmable & { firma: string | null | undefined },
  clave: string,
): boolean {
  if (typeof ancla.firma !== 'string' || !/^[0-9a-f]{64}$/.test(ancla.firma)) {
    return false;
  }
  const esperada = Buffer.from(firmarAncla(ancla, clave), 'hex');
  const recibida = Buffer.from(ancla.firma, 'hex');
  return (
    esperada.length === recibida.length && timingSafeEqual(esperada, recibida)
  );
}

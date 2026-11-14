/**
 * Periodo trimestral de liquidación de IVA (`AAAA-T1`..`AAAA-T4`).
 * Lógica pura, sin dependencias de zona horaria: se trabaja con cadenas ISO.
 */

export const PERIODO_IVA_ANIO_MIN = 2000;
export const PERIODO_IVA_ANIO_MAX = 2100;

export interface RangoPeriodoIva {
  from: string;
  to: string;
}

const PERIODO_RE = /^(\d{4})-T([1-4])$/;
const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Inicio y fin (MM-DD) de cada trimestre. Ningún trimestre termina en
// febrero, así que el año bisiesto no influye.
const TRIMESTRES: Record<number, [string, string]> = {
  1: ['01-01', '03-31'],
  2: ['04-01', '06-30'],
  3: ['07-01', '09-30'],
  4: ['10-01', '12-31'],
};

function validarAnio(anio: number, original: string): void {
  if (anio < PERIODO_IVA_ANIO_MIN || anio > PERIODO_IVA_ANIO_MAX) {
    throw new Error(
      `Año fuera de rango en "${original}" (${PERIODO_IVA_ANIO_MIN}-${PERIODO_IVA_ANIO_MAX})`,
    );
  }
}

/** `AAAA-Tn` -> `{ from, to }` en ISO `YYYY-MM-DD`. Lanza Error si es inválido. */
export function rangoPeriodoIva(periodo: string): RangoPeriodoIva {
  const m = typeof periodo === 'string' ? PERIODO_RE.exec(periodo) : null;
  if (!m) {
    throw new Error(
      `Periodo de IVA no válido: "${String(periodo)}" (formato AAAA-T1..AAAA-T4)`,
    );
  }
  validarAnio(Number(m[1]), periodo);
  const [ini, fin] = TRIMESTRES[Number(m[2])];
  return { from: `${m[1]}-${ini}`, to: `${m[1]}-${fin}` };
}

/** Fecha ISO `YYYY-MM-DD` -> trimestre `AAAA-Tn`. Lanza Error si es inválida. */
export function periodoIvaDeFecha(fecha: string): string {
  const m = typeof fecha === 'string' ? FECHA_RE.exec(fecha) : null;
  if (!m) {
    throw new Error(`Fecha no válida: "${String(fecha)}" (formato AAAA-MM-DD)`);
  }
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    d.getUTCFullYear() !== anio ||
    d.getUTCMonth() !== mes - 1 ||
    d.getUTCDate() !== dia
  ) {
    throw new Error(`Fecha no válida: "${fecha}" (no existe en el calendario)`);
  }
  validarAnio(anio, fecha);
  return `${m[1]}-T${Math.floor((mes - 1) / 3) + 1}`;
}

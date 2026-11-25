/**
 * Aplicación del resultado del ejercicio (cuenta 129) y cuentas anuales (PGC),
 * al estilo de SAP FI-GL (traspaso del resultado a reservas) y Oracle
 * Financial Reporting (balance y cuenta de resultados).
 *
 * La aplicación se contabiliza en el ejercicio siguiente al cerrado (donde la
 * apertura dejó el saldo de 1290), con el reparto acordado: reservas,
 * remanente, compensación de pérdidas y dividendos (beneficio), o resultados
 * negativos y compensación con reservas (pérdida). Se anula por
 * contra-asiento. Reglas puras en `calculo.ts` (`aplicacionResultado`,
 * `cuentasAnuales`).
 */

import { z } from 'zod';
import type {
  CuentasAnualesCalculo,
  EstadoFlujosEfectivo,
  FilaEcpn,
  PartidaConciliacion,
} from './calculo';
import type { Transiciones } from './maquina-estados';

export const ESTADOS_APLICACION_RESULTADO = ['aplicado', 'anulado'] as const;
export type EstadoAplicacionResultado =
  (typeof ESTADOS_APLICACION_RESULTADO)[number];

export const ESTADO_APLICACION_RESULTADO_LABELS: Record<
  EstadoAplicacionResultado,
  string
> = { aplicado: 'Aplicado', anulado: 'Anulado' };

export const APLICACION_RESULTADO_TRANSITIONS: Transiciones<EstadoAplicacionResultado> =
  { aplicado: ['anulado'], anulado: [] };

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

const importe = z
  .number()
  .finite()
  .positive()
  .max(9_999_999_999.99)
  .refine(
    (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
    'Como máximo dos decimales',
  );

export const aplicacionResultadoSchema = z.object({
  /** Fecha del acuerdo (en el ejercicio siguiente al aplicado). */
  fecha,
  reparto: z
    .array(z.object({ cuenta: z.string().regex(/^\d{4}$/), importe }))
    .min(1)
    .max(6),
  /** Referencia del acuerdo de la junta (acta). */
  acuerdo: z.string().trim().min(3).max(240),
  /**
   * Confirmación expresa para contabilizar un acuerdo posterior al plazo de
   * seis meses (art. 164 LSC); sin ella, RESULT_APPLICATION_DEADLINE_EXCEEDED.
   */
  aceptarFueraDePlazo: z.boolean().optional(),
});
export type AplicacionResultadoInput = z.input<
  typeof aplicacionResultadoSchema
>;

export const aplicacionResultadoAnularSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
});
export type AplicacionResultadoAnularInput = z.input<
  typeof aplicacionResultadoAnularSchema
>;

export interface AplicacionResultadoDto {
  id: string;
  ejercicio: number;
  estado: EstadoAplicacionResultado;
  resultado: number;
  fecha: string;
  acuerdo: string;
  reparto: { cuenta: string; nombre: string; importe: number }[];
  asientoId: string | null;
  contraAsientoId: string | null;
  motivoAnulacion: string | null;
  version: number;
}

/** Lo necesario para proponer la aplicación de un ejercicio cerrado. */
export interface PropuestaAplicacionResultadoDto {
  ejercicio: number;
  /** Resultado del cierre vigente (beneficio > 0); null si no está cerrado. */
  resultado: number | null;
  cerrado: boolean;
  capital: number;
  reservaLegal: number;
  reservasVoluntarias: number;
  remanente: number;
  /** Saldo deudor de 1210 (pérdidas pendientes de compensar). */
  negativosAnteriores: number;
  reservaLegalMinima: number;
  /** Fecha límite de la junta ordinaria (30-06 del ejercicio siguiente). */
  fechaLimite: string;
  /** Patrimonio neto tras la apertura, con el resultado pendiente en 129. */
  patrimonioNeto: number;
  /** Arts. 273.2 y 363.1.e LSC. */
  situacionPatrimonial: {
    bajoCapital: boolean;
    desequilibrio: boolean;
    margen: number;
  };
  /** Dividendo máximo que no deja el PN por debajo del capital. */
  dividendoMaximo: number;
  /** Destinos admitidos según el signo del resultado. */
  destinos: { cuenta: string; nombre: string }[];
  aplicacionVigente: AplicacionResultadoDto | null;
}

export interface CuentasAnualesDto extends CuentasAnualesCalculo {
  ejercicio: number;
  /** Fecha de cierre del balance (31-12). */
  fecha: string;
  /** El ejercicio tiene cierre vigente (el informe excluye sus asientos de cierre). */
  cerrado: boolean;
  /** Aplicación vigente del resultado de este ejercicio (estado de distribución). */
  aplicacion: AplicacionResultadoDto | null;
  /** Estado de cambios en el patrimonio neto. */
  ecpn: { filas: FilaEcpn[]; saldoFinal: FilaEcpn; cuadraConBalance: boolean };
  /** Estado de flujos de efectivo (método indirecto). */
  efe: EstadoFlujosEfectivo;
}

/* ───────────────────── conciliación de cierre (auxiliar ↔ mayor) ───────────────────── */

/**
 * Conciliación del estado actual: los auxiliares (devengos, amortización,
 * obra en curso, provisión) no guardan saldo histórico, así que se compara
 * con el mayor completo a la fecha de la consulta.
 */
export interface ConciliacionCierreDto {
  /** Id del registro guardado (null en la consulta en vivo). */
  id: string | null;
  /** Fecha de corte: la de la consulta o el registro. */
  fecha: string;
  partidas: PartidaConciliacion[];
  cuadra: boolean;
  descuadres: number;
  ejecutadoEn: string | null;
}

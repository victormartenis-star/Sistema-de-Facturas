import { z } from 'zod';

/**
 * Mantenimiento preventivo e IoT de flota (Fase 14).
 *
 * Se apoya en el maestro de equipos de Fase 13 (`@erp/shared` → `equipos.ts`):
 * este módulo solo añade la ingesta de telemetría del dispositivo IoT
 * instalado en cada máquina/vehículo y las alertas que dispara. No duplica
 * ficha de equipo ni histórico de mantenimiento.
 */

export const IOT_ALERTA_TIPOS = [
  'averia',
  'anomalia_telemetria',
  'mantenimiento_vencido',
] as const;
export type IotAlertaTipo = (typeof IOT_ALERTA_TIPOS)[number];

export const IOT_ALERTA_TIPO_LABELS: Record<IotAlertaTipo, string> = {
  averia: 'Avería',
  anomalia_telemetria: 'Anomalía de telemetría',
  mantenimiento_vencido: 'Mantenimiento vencido',
};

export const IOT_ALERTA_GRAVEDADES = ['leve', 'grave', 'critica'] as const;
export type IotAlertaGravedad = (typeof IOT_ALERTA_GRAVEDADES)[number];

export const IOT_ALERTA_GRAVEDAD_LABELS: Record<IotAlertaGravedad, string> = {
  leve: 'Leve',
  grave: 'Grave',
  critica: 'Crítica',
};

export const IOT_ALERTA_ESTADOS = ['abierta', 'reconocida', 'cerrada'] as const;
export type IotAlertaEstado = (typeof IOT_ALERTA_ESTADOS)[number];

export const IOT_ALERTA_ESTADO_LABELS: Record<IotAlertaEstado, string> = {
  abierta: 'Abierta',
  reconocida: 'Reconocida',
  cerrada: 'Cerrada',
};

/** Umbrales de telemetría que disparan una alerta automática al ingerir una lectura. */
export const IOT_TEMPERATURA_MOTOR_LEVE = 105;
export const IOT_TEMPERATURA_MOTOR_CRITICA = 120;
export const IOT_COMBUSTIBLE_NIVEL_MINIMO_PCT = 5;

export const telemetriaIngestSchema = z.object({
  equipoId: z.string().uuid('El equipo es obligatorio'),
  projectId: z.string().uuid('Obra no válida').nullish(),
  /** Instante de captura reportado por el dispositivo; por defecto ahora. */
  capturadoEn: z.string().datetime().nullish(),
  horasUso: z.number().nonnegative().max(999_999).nullish(),
  kmRecorridos: z.number().nonnegative().max(999_999).nullish(),
  combustibleNivelPct: z.number().min(0).max(100).nullish(),
  temperaturaMotor: z.number().min(-50).max(500).nullish(),
  ubicacionLat: z.number().min(-90).max(90).nullish(),
  ubicacionLng: z.number().min(-180).max(180).nullish(),
  codigoError: z.string().trim().max(50).nullish(),
  payload: z.record(z.unknown()).default({}),
});

export type TelemetriaIngestInput = z.input<typeof telemetriaIngestSchema>;

export interface TelemetriaLecturaDto {
  id: string;
  equipoId: string;
  projectId: string | null;
  capturadoEn: string;
  horasUso: number | null;
  kmRecorridos: number | null;
  combustibleNivelPct: number | null;
  temperaturaMotor: number | null;
  ubicacionLat: number | null;
  ubicacionLng: number | null;
  codigoError: string | null;
  createdAt: string;
}

export const alertaReconocerSchema = z.object({});
export const alertaCerrarSchema = z.object({
  notas: z.string().trim().max(500).nullish(),
});

export interface IotAlertaDto {
  id: string;
  equipoId: string;
  equipoNombre: string;
  lecturaId: string | null;
  tipo: IotAlertaTipo;
  gravedad: IotAlertaGravedad;
  estado: IotAlertaEstado;
  mensaje: string;
  reconocidaPorUserId: string | null;
  cerradaAt: string | null;
  createdAt: string;
}

/* ────────────────────── evaluación pura de alertas ────────────────────── */

export interface AlertaCandidata {
  tipo: IotAlertaTipo;
  gravedad: IotAlertaGravedad;
  mensaje: string;
}

/**
 * Evalúa una lectura de telemetría y devuelve las alertas que debería
 * disparar (avería por código de error, anomalías por umbral). Pura: no
 * toca la base de datos, así que el criterio de detección se puede probar
 * sin levantar Postgres.
 */
export function evaluateTelemetriaAlertas(input: {
  codigoError?: string | null;
  temperaturaMotor?: number | null;
  combustibleNivelPct?: number | null;
}): AlertaCandidata[] {
  const alertas: AlertaCandidata[] = [];

  if (input.codigoError) {
    alertas.push({
      tipo: 'averia',
      gravedad: 'grave',
      mensaje: `Código de avería ${input.codigoError} reportado por el equipo`,
    });
  }

  if (
    input.temperaturaMotor !== null &&
    input.temperaturaMotor !== undefined &&
    input.temperaturaMotor > IOT_TEMPERATURA_MOTOR_LEVE
  ) {
    alertas.push({
      tipo: 'anomalia_telemetria',
      gravedad:
        input.temperaturaMotor > IOT_TEMPERATURA_MOTOR_CRITICA
          ? 'critica'
          : 'leve',
      mensaje: `Temperatura de motor anómala: ${input.temperaturaMotor}°C`,
    });
  }

  if (
    input.combustibleNivelPct !== null &&
    input.combustibleNivelPct !== undefined &&
    input.combustibleNivelPct < IOT_COMBUSTIBLE_NIVEL_MINIMO_PCT
  ) {
    alertas.push({
      tipo: 'anomalia_telemetria',
      gravedad: 'leve',
      mensaje: `Nivel de combustible crítico: ${input.combustibleNivelPct}%`,
    });
  }

  return alertas;
}

/** Un equipo tiene el mantenimiento vencido si su próxima revisión ya pasó. */
export function isMantenimientoVencido(
  proximaRevisionFecha: string | null,
  hoyIso: string,
): boolean {
  if (!proximaRevisionFecha) return false;
  return proximaRevisionFecha < hoyIso;
}

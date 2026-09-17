import { z } from 'zod';

/**
 * Notificaciones proactivas (Fase 13). Hasta ahora las alertas del ERP
 * (compliance PRL, permisos públicos, sobrecoste, garantía de postventa)
 * eran cálculo bajo demanda — un `GET` que hay que entrar a mirar. Este
 * módulo añade: reglas de umbral configurables por empresa (`alert_rules`,
 * una por tipo) y una bandeja in-app (`notifications`) que rellena un cron
 * al evaluarlas, con salida a email opcional si hay SMTP configurado.
 */

export const ALERT_RULE_TYPES = [
  'compliance_doc',
  'permiso',
  'sobrecoste',
  'garantia_postventa',
] as const;
export type AlertRuleType = (typeof ALERT_RULE_TYPES)[number];

export const ALERT_RULE_TYPE_LABELS: Record<AlertRuleType, string> = {
  compliance_doc: 'Documentación de homologación',
  permiso: 'Permisos y licencias',
  sobrecoste: 'Sobrecoste de partida',
  garantia_postventa: 'Garantía de postventa',
};

/** Tipos que se miden en días antes de caducidad (todos salvo `sobrecoste`, que es un %). */
export const ALERT_RULE_TYPES_BY_DAYS = [
  'compliance_doc',
  'permiso',
  'garantia_postventa',
] as const;

export const ALERT_CHANNELS = ['in_app', 'email'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const ALERT_CHANNEL_LABELS: Record<AlertChannel, string> = {
  in_app: 'En la app',
  email: 'Correo electrónico',
};

/** Umbrales por defecto la primera vez que una empresa pide sus reglas (se persisten al leerlas, no son solo un valor en memoria). */
export const ALERT_RULE_DEFAULTS: Record<
  AlertRuleType,
  { thresholdDays: number | null; thresholdPct: number | null }
> = {
  compliance_doc: { thresholdDays: 30, thresholdPct: null },
  permiso: { thresholdDays: 30, thresholdPct: null },
  sobrecoste: { thresholdDays: null, thresholdPct: 0 },
  garantia_postventa: { thresholdDays: 15, thresholdPct: null },
};

export const alertRuleUpdateSchema = z
  .object({
    thresholdDays: z
      .number({ invalid_type_error: 'Debe ser un número' })
      .int()
      .min(0)
      .max(365)
      .nullish(),
    thresholdPct: z
      .number({ invalid_type_error: 'Debe ser un número' })
      .min(0)
      .max(1000)
      .nullish(),
    channels: z.array(z.enum(ALERT_CHANNELS)).min(1).max(2).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Indica al menos un campo a actualizar',
  });
export type AlertRuleUpdateInput = z.input<typeof alertRuleUpdateSchema>;

export interface AlertRuleDto {
  id: string;
  type: AlertRuleType;
  thresholdDays: number | null;
  thresholdPct: number | null;
  channels: AlertChannel[];
  enabled: boolean;
  updatedAt: string;
}

export interface NotificationDto {
  id: string;
  type: AlertRuleType;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationsRunSummaryDto {
  evaluated: AlertRuleType[];
  created: number;
  emailsSent: number;
  emailsSkippedNoSmtp: boolean;
}

/* ────────────────────── cálculo puro ────────────────────── */

/** true si faltan `thresholdDays` días o menos para la caducidad (o ya caducó: `daysRemaining` negativo). */
export function withinAlertWindow(
  daysRemaining: number,
  thresholdDays: number,
): boolean {
  return daysRemaining <= thresholdDays;
}

/** true si la desviación (%) supera el umbral tolerado — 0 = cualquier sobrecoste avisa, igual que el comportamiento previo sin umbral. */
export function overSobrecosteThreshold(
  deviationPct: number | null,
  thresholdPct: number,
): boolean {
  return deviationPct !== null && deviationPct > thresholdPct;
}

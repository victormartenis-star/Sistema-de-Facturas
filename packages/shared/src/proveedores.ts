import { z } from 'zod';
import { daysBetween } from './calculo';

/**
 * Proveedores y subcontratas: ficha extendida (Fase 11).
 *
 * Complementa el maestro unificado `contacts` con los datos de origen/
 * ejecución que exige compras internacional, y añade el control documental
 * de PRL (Prevención de Riesgos Laborales) por proveedor: mientras un
 * documento bloqueante esté vencido, el proveedor no está apto para pago
 * (ver `validarAptoParaPago` en el servicio).
 */

export const PROVEEDOR_TIPOS = ['proveedor', 'subcontrata'] as const;
export type ProveedorTipo = (typeof PROVEEDOR_TIPOS)[number];

export const CONTRATO_SUBCONTRATA_STATUSES = [
  'borrador',
  'activo',
  'completado',
  'cancelado',
] as const;
export type ContratoSubcontrataStatus =
  (typeof CONTRATO_SUBCONTRATA_STATUSES)[number];

export const DOCUMENTO_PRL_TYPES = [
  'plan_seguridad',
  'seguro_rc',
  'certificado_ss',
  'itinerario_formativo',
  'epi',
  'otro',
] as const;
export type DocumentoPRLType = (typeof DOCUMENTO_PRL_TYPES)[number];

export const DOCUMENTO_PRL_STATUSES = [
  'vigente',
  'proximo_vencimiento',
  'vencido',
  'rechazado',
] as const;
export type DocumentoPRLStatus = (typeof DOCUMENTO_PRL_STATUSES)[number];

/** Tipos de documento PRL que bloquean el pago si están vencidos. */
export const DOCUMENTOS_PRL_BLOQUEANTES: DocumentoPRLType[] = [
  'plan_seguridad',
  'seguro_rc',
  'certificado_ss',
  'itinerario_formativo',
  'epi',
];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

/* ────────────────────── esquemas de entrada ────────────────────── */

export const proveedorCreateSchema = z.object({
  contactId: z.string().uuid('Contacto no válido').nullish(),
  razonSocial: z
    .string()
    .trim()
    .min(1, 'La razón social es obligatoria')
    .max(200),
  cifNif: z.string().trim().min(1, 'El CIF/NIF es obligatorio').max(20),
  tipo: z.enum(PROVEEDOR_TIPOS).default('proveedor'),
  categoriaPrincipal: z.string().trim().max(100).nullish(),
  pais: z.string().trim().length(2, 'Código ISO de 2 letras').default('ES'),
  paisEjecucion: z
    .string()
    .trim()
    .length(2, 'Código ISO de 2 letras')
    .default('ES'),
  paisOrigenMateriales: z
    .string()
    .trim()
    .length(2, 'Código ISO de 2 letras')
    .nullish(),
  codigoExterno: z.string().trim().max(50).nullish(),
  sedeCentral: z.string().trim().max(200).nullish(),
  contactoComercial: z.string().trim().max(150).nullish(),
  telefonoContacto: z.string().trim().max(30).nullish(),
  emailContacto: z
    .string()
    .trim()
    .email('Email no válido')
    .nullish()
    .or(z.literal('')),
  condicionesPagoDias: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .int()
    .min(0, 'No puede ser negativo')
    .max(365, 'Máximo 365 días')
    .default(30),
  retencionGarantiaPct: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .min(0, 'No puede ser negativo')
    .max(50, 'Máximo 50%')
    .default(5),
  activo: z.boolean().default(true),
  notas: z.string().trim().max(2000).nullish(),
});

export const proveedorUpdateSchema = proveedorCreateSchema.partial();

export type ProveedorCreateInput = z.input<typeof proveedorCreateSchema>;
export type ProveedorUpdateInput = z.input<typeof proveedorUpdateSchema>;

export const documentoPRLUploadSchema = z.object({
  docType: z.enum(DOCUMENTO_PRL_TYPES),
  numeroExpediente: z
    .string()
    .trim()
    .min(1, 'El número de expediente es obligatorio')
    .max(100),
  fechaEmision: isoDate,
  fechaVencimiento: isoDate,
  notas: z.string().trim().max(2000).nullish(),
});

export type DocumentoPRLUploadInput = z.input<typeof documentoPRLUploadSchema>;

export const contratoSubcontrataCreateSchema = z.object({
  proveedorId: z.string().uuid('El proveedor es obligatorio'),
  proyectoId: z.string().uuid('La obra es obligatoria'),
  numeroContrato: z
    .string()
    .trim()
    .min(1, 'El número de contrato es obligatorio')
    .max(50),
  fechaInicio: isoDate,
  fechaFinPrevista: isoDate,
  importeTotal: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .positive('El importe debe ser mayor que 0'),
  retencionGarantiaPct: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .min(0)
    .max(50)
    .default(5),
  condicionesEspeciales: z.string().trim().max(2000).nullish(),
  notas: z.string().trim().max(2000).nullish(),
});

export const contratoSubcontrataUpdateSchema = contratoSubcontrataCreateSchema
  .omit({ proveedorId: true, proyectoId: true })
  .partial()
  .extend({
    fechaFinReal: isoDate.nullish(),
    firmaFecha: isoDate.nullish(),
    status: z.enum(CONTRATO_SUBCONTRATA_STATUSES).optional(),
    importeEjecutado: z
      .number({ invalid_type_error: 'Debe ser un número' })
      .nonnegative()
      .optional(),
  });

export type ContratoSubcontrataCreateInput = z.input<
  typeof contratoSubcontrataCreateSchema
>;
export type ContratoSubcontrataUpdateInput = z.input<
  typeof contratoSubcontrataUpdateSchema
>;

/* ─────────────────────────────── lógica pura ─────────────────────────────── */

/**
 * Estado de vigencia de un documento PRL según su fecha de vencimiento.
 * `horizonDays` es la ventana de aviso previo (30 días por defecto). La
 * fecha de referencia se pasa como parámetro ISO (no se lee el reloj) para
 * que el resultado sea reproducible — mismo criterio que `complianceDocStatus`.
 */
export function computeDocumentoPRLStatus(
  fechaVencimiento: string,
  today: string,
  horizonDays = 30,
): DocumentoPRLStatus {
  const days = daysBetween(today, fechaVencimiento);
  if (days < 0) return 'vencido';
  if (days <= horizonDays) return 'proximo_vencimiento';
  return 'vigente';
}

/**
 * Un proveedor está apto para pago cuando ninguno de sus documentos PRL
 * bloqueantes está vencido o próximo a vencer (ventana de `horizonDays`).
 */
export function validarAptoParaPago(
  docs: { docType: DocumentoPRLType; fechaVencimiento: string }[],
  today: string,
  horizonDays = 30,
): { apto: boolean; razones: string[] } {
  const razones: string[] = [];
  for (const doc of docs) {
    if (!DOCUMENTOS_PRL_BLOQUEANTES.includes(doc.docType)) continue;
    const status = computeDocumentoPRLStatus(
      doc.fechaVencimiento,
      today,
      horizonDays,
    );
    if (status === 'vencido') {
      razones.push(
        `Documento PRL vencido: ${doc.docType} (venció ${doc.fechaVencimiento})`,
      );
    } else if (status === 'proximo_vencimiento') {
      razones.push(
        `Documento PRL próximo a vencer: ${doc.docType} (vence el ${doc.fechaVencimiento})`,
      );
    }
  }
  return { apto: razones.length === 0, razones };
}

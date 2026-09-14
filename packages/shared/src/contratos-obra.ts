import { z } from 'zod';

/**
 * Contratación y gestión documental de obra (Fase 12): contratos legales
 * firmados con subcontratistas, proveedores y clientes, con su PDF adjunto
 * (reaprovecha `documents`) y sus cláusulas de retención/abonos. Antes de
 * pasar a `firmado` debe haber PDF y fecha de firma (`validarFirma`), y si
 * el contacto está sujeto a CAE, debe estar homologado (lo exige el
 * servicio llamando a `ComplianceService.assertCanTransact`).
 */

export const CONTRATO_OBRA_TIPOS = [
  'subcontrata',
  'suministro',
  'cliente',
  'alquiler',
  'servicios',
  'otro',
] as const;
export type ContratoObraTipo = (typeof CONTRATO_OBRA_TIPOS)[number];

export const CONTRATO_OBRA_TIPO_LABELS: Record<ContratoObraTipo, string> = {
  subcontrata: 'Subcontrata',
  suministro: 'Suministro',
  cliente: 'Cliente',
  alquiler: 'Alquiler',
  servicios: 'Servicios',
  otro: 'Otro',
};

export const CONTRATO_OBRA_ESTADOS_FIRMA = [
  'borrador',
  'pendiente_firma',
  'firmado',
  'rescindido',
] as const;
export type ContratoObraEstadoFirma =
  (typeof CONTRATO_OBRA_ESTADOS_FIRMA)[number];

export const CONTRATO_OBRA_ESTADO_FIRMA_LABELS: Record<
  ContratoObraEstadoFirma,
  string
> = {
  borrador: 'Borrador',
  pendiente_firma: 'Pendiente de firma',
  firmado: 'Firmado',
  rescindido: 'Rescindido',
};

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const contratoObraCreateSchema = z.object({
  projectId: z.string().uuid('La obra es obligatoria'),
  contactId: z.string().uuid('El subcontratista/cliente es obligatorio'),
  tipo: z.enum(CONTRATO_OBRA_TIPOS),
  importe: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .positive('El importe debe ser mayor que 0'),
  fechaFirma: isoDate.nullish(),
  documentId: z.string().uuid('Documento no válido').nullish(),
  retencionPct: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .min(0)
    .max(50)
    .default(5),
  condicionesAbono: z.string().trim().max(2000).nullish(),
  notas: z.string().trim().max(2000).nullish(),
});

export const contratoObraUpdateSchema = contratoObraCreateSchema
  .omit({ projectId: true, contactId: true })
  .partial()
  .extend({ estadoFirma: z.enum(CONTRATO_OBRA_ESTADOS_FIRMA).optional() });

export type ContratoObraCreateInput = z.input<typeof contratoObraCreateSchema>;
export type ContratoObraUpdateInput = z.input<typeof contratoObraUpdateSchema>;

export const contratoObraAnexoCreateSchema = z.object({
  documentId: z.string().uuid('Documento no válido'),
  descripcion: z
    .string()
    .trim()
    .min(1, 'La descripción es obligatoria')
    .max(200),
});

export type ContratoObraAnexoCreateInput = z.input<
  typeof contratoObraAnexoCreateSchema
>;

export interface ContratoObraDto {
  id: string;
  projectId: string;
  contactId: string;
  tipo: ContratoObraTipo;
  importe: number;
  fechaFirma: string | null;
  documentId: string | null;
  estadoFirma: ContratoObraEstadoFirma;
  retencionPct: number;
  condicionesAbono: string | null;
  notas: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContratoObraAnexoDto {
  id: string;
  contratoId: string;
  documentId: string;
  descripcion: string;
  createdAt: string;
}

/* ─────────────────────────────── lógica pura ─────────────────────────────── */

/**
 * Requisitos mínimos para pasar un contrato a `firmado`: PDF adjunto y
 * fecha de firma. Devuelve la lista de motivos por los que no se puede
 * (vacía ⇒ puede firmarse).
 */
export function validarFirmaContrato(input: {
  documentId: string | null;
  fechaFirma: string | null;
}): string[] {
  const errores: string[] = [];
  if (!input.documentId) {
    errores.push('Falta adjuntar el PDF del contrato firmado');
  }
  if (!input.fechaFirma) {
    errores.push('Falta indicar la fecha de firma');
  }
  return errores;
}

import { z } from 'zod';

/**
 * Firma digital biométrica (Fase 14).
 *
 * Firma electrónica remota para partes, actas, contratos y entregas de
 * EPI. `entityTipo`/`entityId` es una referencia polimórfica ligera al
 * documento que se firma; el módulo que crea la solicitud es responsable de
 * que `entityId` exista en su propia tabla — igual que el resto del ERP no
 * tiene una tabla única de "documentos firmables".
 *
 * El campo `firmaData` que manda el cliente al firmar (trazo capturado en
 * pantalla o biometría del dispositivo, en base64) no se persiste tal cual:
 * la API solo guarda su hash (`hashFirma`), igual que una contraseña.
 */

export const SIGNATURE_ENTITY_TIPOS = [
  'parte_diario',
  'acta_recepcion',
  'contrato_obra',
  'entrega_epi',
  'otro',
] as const;
export type SignatureEntityTipo = (typeof SIGNATURE_ENTITY_TIPOS)[number];

export const SIGNATURE_ENTITY_TIPO_LABELS: Record<SignatureEntityTipo, string> =
  {
    parte_diario: 'Parte diario',
    acta_recepcion: 'Acta de recepción',
    contrato_obra: 'Contrato de obra',
    entrega_epi: 'Entrega de EPI',
    otro: 'Otro documento',
  };

export const SIGNATURE_ESTADOS = [
  'pendiente',
  'completada',
  'cancelada',
  'expirada',
] as const;
export type SignatureEstado = (typeof SIGNATURE_ESTADOS)[number];

export const SIGNATURE_ESTADO_LABELS: Record<SignatureEstado, string> = {
  pendiente: 'Pendiente de firmas',
  completada: 'Completada',
  cancelada: 'Cancelada',
  expirada: 'Expirada',
};

export const SIGNER_ESTADOS = ['pendiente', 'firmado', 'rechazado'] as const;
export type SignerEstado = (typeof SIGNER_ESTADOS)[number];

export const SIGNER_ESTADO_LABELS: Record<SignerEstado, string> = {
  pendiente: 'Pendiente',
  firmado: 'Firmado',
  rechazado: 'Rechazado',
};

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const signatureSignerCreateSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre del firmante es obligatorio')
    .max(200),
  email: z.string().trim().toLowerCase().email('Email no válido').nullish(),
  rol: z.string().trim().max(100).nullish(),
});
export type SignatureSignerCreateInput = z.input<
  typeof signatureSignerCreateSchema
>;

export const signatureRequestCreateSchema = z.object({
  projectId: z.string().uuid('Obra no válida').nullish(),
  entityTipo: z.enum(SIGNATURE_ENTITY_TIPOS),
  entityId: z.string().uuid('El documento a firmar es obligatorio'),
  titulo: z
    .string()
    .trim()
    .min(1, 'El título es obligatorio')
    .max(200, 'Máximo 200 caracteres'),
  documentId: z.string().uuid('Documento no válido').nullish(),
  fechaLimite: isoDate.nullish(),
  firmantes: z
    .array(signatureSignerCreateSchema)
    .min(1, 'Añade al menos un firmante'),
});
export type SignatureRequestCreateInput = z.input<
  typeof signatureRequestCreateSchema
>;

/** Datos de firma recibidos del cliente: trazo/biometría capturados, en base64. */
export const signerFirmarSchema = z.object({
  firmaData: z
    .string()
    .min(1, 'Falta el dato de firma')
    .max(2_000_000, 'La firma capturada es demasiado grande'),
});
export type SignerFirmarInput = z.input<typeof signerFirmarSchema>;

export const signerRechazarSchema = z.object({
  motivo: z.string().trim().min(1, 'Indica el motivo del rechazo').max(500),
});
export type SignerRechazarInput = z.input<typeof signerRechazarSchema>;

export interface SignatureSignerDto {
  id: string;
  nombre: string;
  email: string | null;
  rol: string | null;
  estado: SignerEstado;
  firmadoAt: string | null;
  motivoRechazo: string | null;
}

export interface SignatureRequestDto {
  id: string;
  projectId: string | null;
  entityTipo: SignatureEntityTipo;
  entityId: string;
  titulo: string;
  documentId: string | null;
  estado: SignatureEstado;
  fechaLimite: string | null;
  completedAt: string | null;
  firmantes: SignatureSignerDto[];
  createdAt: string;
}

/* ────────────────────── lógica pura ────────────────────── */

/** Una solicitud está completa cuando todos sus firmantes han firmado. */
export function isRequestComplete(
  firmantes: { estado: SignerEstado }[],
): boolean {
  return firmantes.length > 0 && firmantes.every((f) => f.estado === 'firmado');
}

/** Un solo rechazo basta para que la solicitud ya no pueda completarse. */
export function hasAnyRechazado(
  firmantes: { estado: SignerEstado }[],
): boolean {
  return firmantes.some((f) => f.estado === 'rechazado');
}

export function nextRequestEstado(
  firmantes: { estado: SignerEstado }[],
  current: SignatureEstado,
): SignatureEstado {
  if (current !== 'pendiente') return current;
  if (hasAnyRechazado(firmantes)) return 'cancelada';
  if (isRequestComplete(firmantes)) return 'completada';
  return 'pendiente';
}

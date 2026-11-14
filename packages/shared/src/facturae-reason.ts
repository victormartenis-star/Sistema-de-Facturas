import type { RectificationMotive } from './invoices';

/**
 * Códigos de motivo de rectificación de Facturae (ReasonCode) y su relación
 * con el motivo oficial R1-R4. Vive aparte de `facturae.ts` para que
 * `invoices.ts` pueda validar sin dependencia circular; `facturae.ts` lo
 * reexporta.
 *
 * Literales copiados del XSD oficial 3.2.2 (`ReasonCodeType`,
 * `ReasonDescriptionType`, `CorrectionMethodType` y
 * `CorrectionMethodDescriptionType`). El XSD exige que la descripción sea
 * uno de los literales de su enumeración `ReasonDescriptionType`, que difiere
 * en mayúsculas y espacios de las anotaciones de `ReasonCodeType`.
 */

export const FACTURAE_REASON_CODES = {
  '01': 'Número de la factura',
  '02': 'Serie de la factura',
  '03': 'Fecha expedición',
  '04': 'Nombre y apellidos/Razón Social-Emisor',
  '05': 'Nombre y apellidos/Razón Social-Receptor',
  '06': 'Identificación fiscal Emisor/obligado',
  '07': 'Identificación fiscal Receptor',
  '08': 'Domicilio Emisor/Obligado',
  '09': 'Domicilio Receptor',
  '10': 'Detalle Operación',
  '11': 'Porcentaje impositivo a aplicar',
  '12': 'Cuota tributaria a aplicar',
  '13': 'Fecha/Periodo a aplicar',
  '14': 'Clase de factura',
  '15': 'Literales legales',
  '16': 'Base imponible',
  '80': 'Cálculo de cuotas repercutidas',
  '81': 'Cálculo de cuotas retenidas',
  '82': 'Base imponible modificada por devolución de envases / embalajes',
  '83': 'Base imponible modificada por descuentos y bonificaciones',
  '84': 'Base imponible modificada por resolución firme, judicial o administrativa',
  '85': 'Base imponible modificada cuotas repercutidas no satisfechas. Auto de declaración de concurso',
} as const;
export type FacturaeReasonCode = keyof typeof FACTURAE_REASON_CODES;

/**
 * Códigos de motivo Facturae admitidos para cada motivo R1-R4. El titular
 * elige el código de forma EXPLÍCITA: no hay valor por defecto ni mapeo
 * automático. Listas tomadas del diseño de auditoría.
 * - R1 (art. 80.1, 80.2, error fundado en derecho).
 * - R2 (art. 80.3, concurso).
 * - R3 (art. 80.4, créditos incobrables): APROXIMACIÓN. El XSD no tiene un
 *   código exacto para incobrables; se admite '85' provisionalmente y
 *   REQUIERE CONFIRMACIÓN DEL TITULAR.
 * - R4 (resto): cualquier código válido.
 */
const REASON_CODES_BY_MOTIVE: Record<
  Exclude<RectificationMotive, 'R4'>,
  readonly FacturaeReasonCode[]
> = {
  R1: ['80', '82', '83', '84', '11', '12', '16'],
  R2: ['85'],
  R3: ['85'],
};

export function allowedFacturaeReasonCodes(
  motive: RectificationMotive,
): FacturaeReasonCode[] {
  if (motive === 'R4') {
    return Object.keys(FACTURAE_REASON_CODES) as FacturaeReasonCode[];
  }
  return [...REASON_CODES_BY_MOTIVE[motive]];
}

/** Errores de coherencia entre motivo R1-R4 y código Facturae (vacía si es válido). */
export function facturaeReasonCodeErrors(
  motive: RectificationMotive,
  code: string | null | undefined,
): string[] {
  if (code === undefined || code === null || code === '') {
    return ['El código de motivo Facturae es obligatorio'];
  }
  if (!Object.hasOwn(FACTURAE_REASON_CODES, code)) {
    return [`Código de motivo Facturae no válido: "${code}"`];
  }
  const allowed = allowedFacturaeReasonCodes(motive);
  if (!(allowed as string[]).includes(code)) {
    return [
      `El código de motivo Facturae ${code} no es válido para el motivo ${motive}: use ${allowed.join(', ')}`,
    ];
  }
  return [];
}

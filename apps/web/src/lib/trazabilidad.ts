import type { FacturaeXsdStatus } from '@erp/shared';

/** Texto del panel de trazabilidad para la validación XSD persistida de Facturae. */
export function etiquetaXsd(
  status: FacturaeXsdStatus | null | undefined,
): string {
  if (status === 'valido') return 'Válido';
  if (status === 'no_valido') return 'No válido';
  return 'No disponible';
}

/** Referencia a la certificación original de una rectificativa. */
export function etiquetaCertificacionOriginal(
  seq: number | null | undefined,
): string | null {
  return seq == null ? null : `Certificación nº ${seq}`;
}

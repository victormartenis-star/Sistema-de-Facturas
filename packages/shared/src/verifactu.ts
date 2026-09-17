/**
 * VeriFactu real (Fase 14): el *Registro de Facturación* que exige el
 * Reglamento RD 1007/2023 y la Orden HAC/1177/2024, distinto de la huella
 * interna que ya se persistía desde la Fase 11 (`invoices.verifactu_hash`,
 * ver `facturae.ts`) — aquella era solo trazabilidad propia; esto es la
 * estructura XML del registro real que se enviaría a la AEAT.
 *
 * **No verificado contra la AEAT real.** Esta implementación sigue la
 * disposición de campos publicada del Reglamento y su documentación
 * técnica, pero este entorno no dispone de un certificado digital
 * cualificado ni de credenciales de desarrollador de la AEAT para probar
 * un envío real — ni siquiera contra el entorno de pruebas. Antes de un
 * uso real, esta estructura debe revisarse contra la especificación
 * técnica vigente en el momento del despliegue (el Reglamento ha tenido
 * variaciones desde su publicación) y contra un caso de prueba de la AEAT.
 */

export const VERIFACTU_STATUSES = [
  'no_generado',
  'generado_local',
  'enviado',
  'error',
] as const;
export type VerifactuStatus = (typeof VERIFACTU_STATUSES)[number];

export const VERIFACTU_STATUS_LABELS: Record<VerifactuStatus, string> = {
  no_generado: 'Sin generar',
  generado_local: 'Generado (sin enviar)',
  enviado: 'Enviado a la AEAT',
  error: 'Error de envío',
};

export interface RegistroAltaInput {
  issuerTaxId: string;
  issuerName: string;
  invoiceNumber: string;
  /** ISO `AAAA-MM-DD`. */
  issueDate: string;
  vatAmount: number;
  totalAmount: number;
  /** Huella de este registro (ver `verifactuCanonicalString` en `facturae.ts` — no se recalcula aquí, se reutiliza). */
  hash: string;
  previousHash: string;
  /** ISO 8601 con offset. */
  generatedAt: string;
  /** Identificación del sistema informático emisor, obligatoria en el registro real. */
  softwareName: string;
  softwareVersion: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function money(n: number): string {
  return n.toFixed(2);
}

/** Construye el XML del `RegistroAlta` VeriFactu. Función pura. */
export function buildRegistroAltaXml(input: RegistroAltaInput): string {
  const [y, m, d] = input.issueDate.split('-');
  const fechaExpedicion = `${d}-${m}-${y}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<sum:RegistroAlta xmlns:sum="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroInformacion.xsd">
  <sum:IDVersion>1.0</sum:IDVersion>
  <sum:IDFactura>
    <sum:IDEmisorFactura>${escapeXml(input.issuerTaxId)}</sum:IDEmisorFactura>
    <sum:NumSerieFactura>${escapeXml(input.invoiceNumber)}</sum:NumSerieFactura>
    <sum:FechaExpedicionFactura>${fechaExpedicion}</sum:FechaExpedicionFactura>
  </sum:IDFactura>
  <sum:NombreRazonEmisor>${escapeXml(input.issuerName)}</sum:NombreRazonEmisor>
  <sum:TipoFactura>F1</sum:TipoFactura>
  <sum:CuotaTotal>${money(input.vatAmount)}</sum:CuotaTotal>
  <sum:ImporteTotal>${money(input.totalAmount)}</sum:ImporteTotal>
  <sum:Encadenamiento>
    <sum:RegistroAnterior>
      <sum:Huella>${escapeXml(input.previousHash)}</sum:Huella>
    </sum:RegistroAnterior>
  </sum:Encadenamiento>
  <sum:SistemaInformatico>
    <sum:NombreRazon>${escapeXml(input.issuerName)}</sum:NombreRazon>
    <sum:NIF>${escapeXml(input.issuerTaxId)}</sum:NIF>
    <sum:NombreSistemaInformatico>${escapeXml(input.softwareName)}</sum:NombreSistemaInformatico>
    <sum:Version>${escapeXml(input.softwareVersion)}</sum:Version>
  </sum:SistemaInformatico>
  <sum:FechaHoraHusoGenRegistro>${escapeXml(input.generatedAt)}</sum:FechaHoraHusoGenRegistro>
  <sum:Huella>${escapeXml(input.hash)}</sum:Huella>
</sum:RegistroAlta>
`;
}

import { round2 } from './calculo';
import { ISP_LEGEND } from './invoices';

/**
 * Facturae XML (formato de factura electrónica española) y huella de
 * encadenamiento VeriFactu, para facturas de venta.
 *
 * **Alcance deliberadamente preliminar** — no es un generador legalmente
 * válido para presentar ante la AEAT:
 * - No incluye firma electrónica XAdES (obligatoria en Facturae real).
 * - No está validado contra el XSD oficial de Facturae 3.2.2.
 * - VeriFactu es en realidad un *Registro de Facturación* (Reglamento RD
 *   1007/2023 y Orden HAC/1177/2024) con su propio esquema XML y envío a la
 *   AEAT; **no** es un campo dentro de Facturae. Aquí se incrusta la huella
 *   como una extensión propia (`AdditionalData/Extensions`) para dejar
 *   constancia interna del encadenamiento, no como sustituto del registro
 *   real.
 * - Emisor y receptor se asumen personas jurídicas residentes en España
 *   (`PersonTypeCode=J`, `ResidenceTypeCode=R`): el esquema no modela esa
 *   distinción para contactos ni empresa.
 * - La dirección fiscal (`AddressInSpain`) no está en el modelo de datos
 *   (`contacts.address` es un jsonb que la API nunca rellena hoy): se usa un
 *   marcador de "sin datos fiscales" explícito en vez de inventar una
 *   dirección real. Antes de un uso real hace falta una migración que añada
 *   esos campos a `companies` y `contacts`.
 *
 * Solo aplica a facturas de **venta**: Facturae describe una factura emitida
 * por el vendedor (nuestra empresa) al comprador (el contacto cliente).
 */

export const FACTURAE_SCHEMA_VERSION = '3.2.2';
export const FACTURAE_NAMESPACE =
  'http://www.facturae.es/Facturae/2014/v3.2.2/Facturae';

/** Se usa cuando no hay dato fiscal real disponible (ver cabecera del fichero). */
export const FACTURAE_UNKNOWN_ADDRESS: FacturaePartyAddress = {
  address: 'Sin dirección fiscal registrada',
  postCode: '00000',
  town: 'Sin especificar',
  province: 'Sin especificar',
  countryCode: 'ESP',
};

export interface FacturaePartyAddress {
  address: string;
  postCode: string;
  town: string;
  province: string;
  countryCode: string;
}

export interface FacturaeParty {
  /** NIF/CIF. Obligatorio: sin él no se puede identificar fiscalmente a la parte. */
  taxId: string;
  name: string;
  address: FacturaePartyAddress;
}

export interface FacturaeLineInput {
  description: string;
  baseAmount: number;
  vatPct: number;
}

export interface FacturaeVerifactuInfo {
  /** Huella SHA-256 de este registro (calculada fuera de este módulo: usa `node:crypto`, no disponible aquí). */
  hash: string;
  /** Huella del registro anterior en la cadena; cadena vacía si es el primero. */
  previousHash: string;
  generatedAt: string;
}

export interface FacturaeInvoiceInput {
  invoiceNumber: string;
  /** AAAA-MM-DD */
  issueDate: string;
  seller: FacturaeParty;
  buyer: FacturaeParty;
  lines: FacturaeLineInput[];
  /** Inversión del sujeto pasivo: IVA 0 + leyenda legal, ver `ISP_LEGEND`. */
  isp: boolean;
  baseAmount: number;
  vatAmount: number;
  retentionPct: number;
  retentionAmount: number;
  totalAmount: number;
  verifactu: FacturaeVerifactuInfo;
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

function partyXml(
  tag: 'SellerParty' | 'BuyerParty',
  party: FacturaeParty,
): string {
  return `
    <${tag}>
      <TaxIdentification>
        <PersonTypeCode>J</PersonTypeCode>
        <ResidenceTypeCode>R</ResidenceTypeCode>
        <TaxIdentificationNumber>${escapeXml(party.taxId)}</TaxIdentificationNumber>
      </TaxIdentification>
      <LegalEntity>
        <CorporateName>${escapeXml(party.name)}</CorporateName>
        <AddressInSpain>
          <Address>${escapeXml(party.address.address)}</Address>
          <PostCode>${escapeXml(party.address.postCode)}</PostCode>
          <Town>${escapeXml(party.address.town)}</Town>
          <Province>${escapeXml(party.address.province)}</Province>
          <CountryCode>${escapeXml(party.address.countryCode)}</CountryCode>
        </AddressInSpain>
      </LegalEntity>
    </${tag}>`;
}

interface VatGroup {
  vatPct: number;
  base: number;
  amount: number;
}

/** Agrupa las líneas por tipo de IVA: un `<Tax>` por cada tipo distinto. */
function groupByVat(lines: FacturaeLineInput[]): VatGroup[] {
  const bases = new Map<number, number>();
  for (const l of lines) {
    bases.set(l.vatPct, round2((bases.get(l.vatPct) ?? 0) + l.baseAmount));
  }
  return [...bases.entries()]
    .sort(([a], [b]) => a - b)
    .map(([vatPct, base]) => ({
      vatPct,
      base,
      amount: round2((base * vatPct) / 100),
    }));
}

function taxXml(vatPct: number, base: number, amount: number): string {
  return `
        <Tax>
          <TaxTypeCode>01</TaxTypeCode>
          <TaxRate>${money(vatPct)}</TaxRate>
          <TaxableBase><TotalAmount>${money(base)}</TotalAmount></TaxableBase>
          <TaxAmount><TotalAmount>${money(amount)}</TotalAmount></TaxAmount>
        </Tax>`;
}

/**
 * Con ISP el emisor no repercute IVA (lo autoliquida el comprador): se
 * informa un único tipo al 0 %, y la leyenda legal obligatoria va aparte en
 * `LegalLiterals`.
 */
function taxesOutputsXml(lines: FacturaeLineInput[], isp: boolean): string {
  if (isp) {
    const base = round2(lines.reduce((s, l) => s + l.baseAmount, 0));
    return `<TaxesOutputs>${taxXml(0, base, 0)}
      </TaxesOutputs>`;
  }
  const taxes = groupByVat(lines)
    .map((g) => taxXml(g.vatPct, g.base, g.amount))
    .join('');
  return `<TaxesOutputs>${taxes}
      </TaxesOutputs>`;
}

function taxesWithheldXml(
  retentionPct: number,
  baseAmount: number,
  retentionAmount: number,
): string {
  if (retentionAmount <= 0) return '';
  return `
      <TaxesWithheld>
        <Tax>
          <TaxTypeCode>04</TaxTypeCode>
          <TaxRate>${money(retentionPct)}</TaxRate>
          <TaxableBase><TotalAmount>${money(baseAmount)}</TotalAmount></TaxableBase>
          <TaxAmount><TotalAmount>${money(retentionAmount)}</TotalAmount></TaxAmount>
        </Tax>
      </TaxesWithheld>`;
}

/** El sistema no modela cantidad/precio unitario por línea, solo un importe: se asume 1 unidad. */
function lineXml(line: FacturaeLineInput, isp: boolean): string {
  const rate = isp ? 0 : line.vatPct;
  const taxAmount = isp ? 0 : round2((line.baseAmount * line.vatPct) / 100);
  return `
        <InvoiceLine>
          <ItemDescription>${escapeXml(line.description)}</ItemDescription>
          <Quantity>1</Quantity>
          <UnitOfMeasure>01</UnitOfMeasure>
          <UnitPriceWithoutTax>${money(line.baseAmount)}</UnitPriceWithoutTax>
          <TotalCost>${money(line.baseAmount)}</TotalCost>
          <GrossAmount>${money(line.baseAmount)}</GrossAmount>
          <TaxesOutputs>${taxXml(rate, line.baseAmount, taxAmount)}
          </TaxesOutputs>
        </InvoiceLine>`;
}

/** Construye el XML Facturae 3.2.2 de una factura de venta. Función pura. */
export function buildFacturaeXml(input: FacturaeInvoiceInput): string {
  const legalLiterals = input.isp
    ? `
      <LegalLiterals>
        <LegalReference>${escapeXml(ISP_LEGEND)}</LegalReference>
      </LegalLiterals>`
    : '';
  const outstanding = round2(input.totalAmount - input.retentionAmount);

  return `<?xml version="1.0" encoding="UTF-8"?>
<fe:Facturae xmlns:fe="${FACTURAE_NAMESPACE}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <FileHeader>
    <SchemaVersion>${FACTURAE_SCHEMA_VERSION}</SchemaVersion>
    <Modality>I</Modality>
    <InvoiceIssuerType>EM</InvoiceIssuerType>
    <Batch>
      <BatchIdentifier>${escapeXml(input.invoiceNumber)}</BatchIdentifier>
      <InvoicesCount>1</InvoicesCount>
      <TotalInvoicesAmount><TotalAmount>${money(input.totalAmount)}</TotalAmount></TotalInvoicesAmount>
      <TotalOutstandingAmount><TotalAmount>${money(outstanding)}</TotalAmount></TotalOutstandingAmount>
      <TotalExecutableAmount><TotalAmount>${money(outstanding)}</TotalAmount></TotalExecutableAmount>
      <InvoiceCurrencyCode>EUR</InvoiceCurrencyCode>
    </Batch>
  </FileHeader>
  <Parties>${partyXml('SellerParty', input.seller)}${partyXml('BuyerParty', input.buyer)}
  </Parties>
  <Invoices>
    <Invoice>
      <InvoiceHeader>
        <InvoiceNumber>${escapeXml(input.invoiceNumber)}</InvoiceNumber>
        <InvoiceDocumentType>FC</InvoiceDocumentType>
        <InvoiceClass>OO</InvoiceClass>
      </InvoiceHeader>
      <InvoiceIssueData>
        <IssueDate>${input.issueDate}</IssueDate>
        <InvoiceCurrencyCode>EUR</InvoiceCurrencyCode>
        <TaxCurrencyCode>EUR</TaxCurrencyCode>
        <LanguageName>es</LanguageName>
      </InvoiceIssueData>
      ${taxesOutputsXml(input.lines, input.isp)}${taxesWithheldXml(input.retentionPct, input.baseAmount, input.retentionAmount)}
      <InvoiceTotals>
        <TotalGrossAmount>${money(input.baseAmount)}</TotalGrossAmount>
        <TotalGeneralDiscounts>0.00</TotalGeneralDiscounts>
        <TotalGeneralSurcharges>0.00</TotalGeneralSurcharges>
        <TotalGrossAmountBeforeTaxes>${money(input.baseAmount)}</TotalGrossAmountBeforeTaxes>
        <TotalTaxOutputs>${money(input.vatAmount)}</TotalTaxOutputs>
        <TotalTaxesWithheld>${money(input.retentionAmount)}</TotalTaxesWithheld>
        <InvoiceTotal>${money(input.totalAmount)}</InvoiceTotal>
        <TotalOutstandingAmount>${money(outstanding)}</TotalOutstandingAmount>
        <TotalExecutableAmount>${money(outstanding)}</TotalExecutableAmount>
      </InvoiceTotals>${legalLiterals}
      <Items>${input.lines.map((l) => lineXml(l, input.isp)).join('')}
      </Items>
      <AdditionalData>
        <Extensions>
          <Extension>
            <ExtensionName>VeriFactuHashPreliminar</ExtensionName>
            <Hash>${escapeXml(input.verifactu.hash)}</Hash>
            <PreviousHash>${escapeXml(input.verifactu.previousHash)}</PreviousHash>
            <GeneratedAt>${escapeXml(input.verifactu.generatedAt)}</GeneratedAt>
          </Extension>
        </Extensions>
      </AdditionalData>
    </Invoice>
  </Invoices>
</fe:Facturae>
`;
}

/* ───────────────────── VeriFactu: huella de encadenamiento ───────────────────── *
 *
 * VeriFactu exige que cada registro de facturación incluya la huella
 * (SHA-256) del registro anterior, formando una cadena que hace detectable
 * cualquier alteración o borrado retroactivo (Reglamento RD 1007/2023,
 * Orden HAC/1177/2024). El cálculo real del SHA-256 usa `node:crypto` en la
 * API (este paquete es también consumido por `apps/web` en el navegador, y
 * no puede depender de módulos de Node) — aquí solo se construye, de forma
 * pura y testeable, la cadena canónica que se hashea.
 */

export const VERIFACTU_GENESIS_HASH = '';

export interface VerifactuChainRecord {
  /** NIF del emisor (siempre el de nuestra empresa: solo aplica a facturas de venta). */
  issuerTaxId: string;
  invoiceNumber: string;
  /** AAAA-MM-DD */
  issueDate: string;
  vatAmount: number;
  totalAmount: number;
  /** Marca de tiempo del registro, ISO 8601. Se usa `invoice.createdAt` (inmutable) en vez de "ahora": así la huella es reproducible en cada consulta, no solo la primera vez. */
  generatedAt: string;
}

/**
 * Cadena canónica de una factura para el encadenamiento VeriFactu, en el
 * formato de pares `clave=valor` unidos por `&` que usa el registro real de
 * la AEAT. Determinista: mismos datos + misma huella anterior → misma cadena.
 */
export function verifactuCanonicalString(
  record: VerifactuChainRecord,
  previousHash: string,
): string {
  const [y, m, d] = record.issueDate.split('-');
  const fechaExpedicion = `${d}-${m}-${y}`;
  return [
    `IDEmisorFactura=${record.issuerTaxId}`,
    `NumSerieFactura=${record.invoiceNumber}`,
    `FechaExpedicionFactura=${fechaExpedicion}`,
    `TipoFactura=F1`,
    `CuotaTotal=${money(record.vatAmount)}`,
    `ImporteTotal=${money(record.totalAmount)}`,
    `Huella=${previousHash}`,
    `FechaHoraHusoGenRegistro=${record.generatedAt}`,
  ].join('&');
}

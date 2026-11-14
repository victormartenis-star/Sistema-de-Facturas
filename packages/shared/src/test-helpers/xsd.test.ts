import { describe, expect, it } from 'vitest';
import {
  FACTURAE_XSD_FILE,
  XMLDSIG_XSD_FILE,
  sha256OfXsdFile,
  validateFacturaeXsd,
} from './xsd';

const NS = 'http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml';

/** XML mínimo escrito a mano, válido según el XSD (sin pasar por el generador). */
const MINIMAL_VALID = `<?xml version="1.0" encoding="UTF-8"?>
<fe:Facturae xmlns:fe="${NS}">
  <FileHeader>
    <SchemaVersion>3.2.2</SchemaVersion>
    <Modality>I</Modality>
    <InvoiceIssuerType>EM</InvoiceIssuerType>
    <Batch>
      <BatchIdentifier>A1</BatchIdentifier>
      <InvoicesCount>1</InvoicesCount>
      <TotalInvoicesAmount><TotalAmount>121.00</TotalAmount></TotalInvoicesAmount>
      <TotalOutstandingAmount><TotalAmount>121.00</TotalAmount></TotalOutstandingAmount>
      <TotalExecutableAmount><TotalAmount>121.00</TotalAmount></TotalExecutableAmount>
      <InvoiceCurrencyCode>EUR</InvoiceCurrencyCode>
    </Batch>
  </FileHeader>
  <Parties>
    <SellerParty>
      <TaxIdentification>
        <PersonTypeCode>J</PersonTypeCode>
        <ResidenceTypeCode>R</ResidenceTypeCode>
        <TaxIdentificationNumber>B12345678</TaxIdentificationNumber>
      </TaxIdentification>
      <LegalEntity>
        <CorporateName>Emisor SL</CorporateName>
        <AddressInSpain>
          <Address>Calle 1</Address><PostCode>28001</PostCode><Town>Madrid</Town><Province>Madrid</Province><CountryCode>ESP</CountryCode>
        </AddressInSpain>
      </LegalEntity>
    </SellerParty>
    <BuyerParty>
      <TaxIdentification>
        <PersonTypeCode>J</PersonTypeCode>
        <ResidenceTypeCode>R</ResidenceTypeCode>
        <TaxIdentificationNumber>A87654321</TaxIdentificationNumber>
      </TaxIdentification>
      <LegalEntity>
        <CorporateName>Receptor SA</CorporateName>
        <AddressInSpain>
          <Address>Calle 2</Address><PostCode>28002</PostCode><Town>Madrid</Town><Province>Madrid</Province><CountryCode>ESP</CountryCode>
        </AddressInSpain>
      </LegalEntity>
    </BuyerParty>
  </Parties>
  <Invoices>
    <Invoice>
      <InvoiceHeader>
        <InvoiceNumber>A1</InvoiceNumber>
        <InvoiceDocumentType>FC</InvoiceDocumentType>
        <InvoiceClass>OO</InvoiceClass>
      </InvoiceHeader>
      <InvoiceIssueData>
        <IssueDate>2026-01-15</IssueDate>
        <InvoiceCurrencyCode>EUR</InvoiceCurrencyCode>
        <TaxCurrencyCode>EUR</TaxCurrencyCode>
        <LanguageName>es</LanguageName>
      </InvoiceIssueData>
      <TaxesOutputs>
        <Tax>
          <TaxTypeCode>01</TaxTypeCode>
          <TaxRate>21.00</TaxRate>
          <TaxableBase><TotalAmount>100.00</TotalAmount></TaxableBase>
          <TaxAmount><TotalAmount>21.00</TotalAmount></TaxAmount>
        </Tax>
      </TaxesOutputs>
      <InvoiceTotals>
        <TotalGrossAmount>100.00</TotalGrossAmount>
        <TotalGeneralDiscounts>0.00</TotalGeneralDiscounts>
        <TotalGeneralSurcharges>0.00</TotalGeneralSurcharges>
        <TotalGrossAmountBeforeTaxes>100.00</TotalGrossAmountBeforeTaxes>
        <TotalTaxOutputs>21.00</TotalTaxOutputs>
        <TotalTaxesWithheld>0.00</TotalTaxesWithheld>
        <InvoiceTotal>121.00</InvoiceTotal>
        <TotalOutstandingAmount>121.00</TotalOutstandingAmount>
        <TotalExecutableAmount>121.00</TotalExecutableAmount>
      </InvoiceTotals>
      <Items>
        <InvoiceLine>
          <ItemDescription>Obra</ItemDescription>
          <Quantity>1</Quantity>
          <UnitOfMeasure>01</UnitOfMeasure>
          <UnitPriceWithoutTax>100.00</UnitPriceWithoutTax>
          <TotalCost>100.00</TotalCost>
          <GrossAmount>100.00</GrossAmount>
          <TaxesOutputs>
            <Tax>
              <TaxTypeCode>01</TaxTypeCode>
              <TaxRate>21.00</TaxRate>
              <TaxableBase><TotalAmount>100.00</TotalAmount></TaxableBase>
              <TaxAmount><TotalAmount>21.00</TotalAmount></TaxAmount>
            </Tax>
          </TaxesOutputs>
        </InvoiceLine>
      </Items>
    </Invoice>
  </Invoices>
</fe:Facturae>
`;

describe('esquemas XSD de test', () => {
  it('conservan el sha256 de los originales oficiales', () => {
    expect(sha256OfXsdFile(FACTURAE_XSD_FILE)).toBe(
      'b4bbcd587f5fb0a8a906336cca09b0a40d06ffaa78c6a62f6e438c4e6ea86e07',
    );
    expect(sha256OfXsdFile(XMLDSIG_XSD_FILE)).toBe(
      'd102ad3df7664c307e0c2c776ba4a90513b1969974d8a940bae1a77f9f21e15d',
    );
  });
});

describe('validateFacturaeXsd', () => {
  it('acepta un XML mínimo válido escrito a mano', async () => {
    const r = await validateFacturaeXsd(MINIMAL_VALID);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it('rechaza el namespace antiguo (el validador detecta de verdad)', async () => {
    const bad = MINIMAL_VALID.replace(
      NS,
      'http://www.facturae.es/Facturae/2014/v3.2.2/Facturae',
    );
    const r = await validateFacturaeXsd(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('rechaza un elemento fuera de orden', async () => {
    const bad = MINIMAL_VALID.replace(
      '<InvoiceDocumentType>FC</InvoiceDocumentType>',
      '',
    ).replace(
      '<InvoiceClass>OO</InvoiceClass>',
      '<InvoiceClass>OO</InvoiceClass><InvoiceDocumentType>FC</InvoiceDocumentType>',
    );
    expect((await validateFacturaeXsd(bad)).valid).toBe(false);
  });
});

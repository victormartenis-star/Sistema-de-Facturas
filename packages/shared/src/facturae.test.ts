import { describe, expect, it } from 'vitest';
import {
  FACTURAE_UNKNOWN_ADDRESS,
  VERIFACTU_GENESIS_HASH,
  buildFacturaeXml,
  verifactuCanonicalString,
  type FacturaeInvoiceInput,
} from './facturae';
import { ISP_LEGEND } from './invoices';

/**
 * Comprueba que cada etiqueta abierta (no autocerrada) tiene su cierre y que
 * no hay cierres sin apertura. No es un validador de XSD: es una red mínima
 * contra el error más probable al montar XML a mano — una etiqueta que se
 * queda sin cerrar.
 */
function assertWellFormedTags(xml: string): void {
  const tagPattern = /<\/?([a-zA-Z][\w:-]*)\b[^>]*?(\/)?>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(xml))) {
    const [full, name, selfClosing] = match;
    if (full.startsWith('<?')) continue; // declaración XML
    if (selfClosing) continue;
    if (full.startsWith('</')) {
      const last = stack.pop();
      if (last !== name) {
        throw new Error(
          `Etiqueta mal cerrada: esperaba </${last}> y llegó </${name}>`,
        );
      }
    } else {
      stack.push(name);
    }
  }
  if (stack.length > 0) {
    throw new Error(`Etiquetas sin cerrar: ${stack.join(', ')}`);
  }
}

const seller = {
  taxId: 'B12345678',
  name: 'Dintel Construcción SL',
  address: FACTURAE_UNKNOWN_ADDRESS,
};

const buyer = {
  taxId: 'A87654321',
  name: 'Promotora Edificio Sur SA',
  address: FACTURAE_UNKNOWN_ADDRESS,
};

function baseInput(
  overrides: Partial<FacturaeInvoiceInput> = {},
): FacturaeInvoiceInput {
  return {
    invoiceNumber: 'V-2026-0001',
    issueDate: '2026-09-15',
    seller,
    buyer,
    lines: [
      { description: 'Certificación nº 3', baseAmount: 1000, vatPct: 21 },
    ],
    isp: false,
    baseAmount: 1000,
    vatAmount: 210,
    retentionPct: 5,
    retentionAmount: 50,
    totalAmount: 1210,
    verifactu: {
      hash: 'abc123',
      previousHash: '',
      generatedAt: '2026-09-15T10:00:00.000Z',
    },
    ...overrides,
  };
}

describe('buildFacturaeXml', () => {
  it('genera un XML bien formado', () => {
    expect(() =>
      assertWellFormedTags(buildFacturaeXml(baseInput())),
    ).not.toThrow();
  });

  it('incluye la cabecera y los NIF de emisor y receptor', () => {
    const xml = buildFacturaeXml(baseInput());
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<SchemaVersion>3.2.2</SchemaVersion>');
    expect(xml).toContain(
      '<TaxIdentificationNumber>B12345678</TaxIdentificationNumber>',
    );
    expect(xml).toContain(
      '<TaxIdentificationNumber>A87654321</TaxIdentificationNumber>',
    );
  });

  it('vuelca los totales tal cual llegan, sin recalcularlos', () => {
    const xml = buildFacturaeXml(baseInput());
    expect(xml).toContain('<InvoiceTotal>1210.00</InvoiceTotal>');
    expect(xml).toContain('<TotalTaxOutputs>210.00</TotalTaxOutputs>');
    expect(xml).toContain('<TotalTaxesWithheld>50.00</TotalTaxesWithheld>');
    // Pendiente = total - retención
    expect(xml).toContain(
      '<TotalOutstandingAmount>1160.00</TotalOutstandingAmount>',
    );
  });

  it('agrupa las líneas por tipo de IVA en un único <Tax> por tipo', () => {
    const xml = buildFacturaeXml(
      baseInput({
        lines: [
          { description: 'Material', baseAmount: 500, vatPct: 21 },
          { description: 'Mano de obra', baseAmount: 300, vatPct: 21 },
          { description: 'Alimentación obra', baseAmount: 100, vatPct: 10 },
        ],
        baseAmount: 900,
      }),
    );
    // Solo dos <TaxRate> distintos en TaxesOutputs de cabecera: 21.00 y 10.00
    const headerRates = xml.match(/<TaxRate>(\d+\.\d\d)<\/TaxRate>/g) ?? [];
    expect(headerRates).toContain('<TaxRate>21.00</TaxRate>');
    expect(headerRates).toContain('<TaxRate>10.00</TaxRate>');
    // Base agregada del 21%: 500 + 300 = 800
    expect(xml).toContain(
      '<TaxableBase><TotalAmount>800.00</TotalAmount></TaxableBase>',
    );
  });

  it('sin retención no añade el bloque TaxesWithheld', () => {
    const xml = buildFacturaeXml(
      baseInput({ retentionAmount: 0, retentionPct: 0 }),
    );
    expect(xml).not.toContain('<TaxesWithheld>');
  });

  it('con ISP declara tipo 0 % e incluye la leyenda legal', () => {
    const xml = buildFacturaeXml(
      baseInput({ isp: true, vatAmount: 0, totalAmount: 1000 - 50 }),
    );
    expect(xml).not.toContain('<TaxRate>21.00</TaxRate>');
    expect(xml).toContain('<TaxRate>0.00</TaxRate>');
    expect(xml).toContain(ISP_LEGEND);
  });

  it('escapa caracteres especiales en textos libres', () => {
    const xml = buildFacturaeXml(
      baseInput({
        lines: [
          {
            description: 'Tubería <20mm> & codos "L"',
            baseAmount: 100,
            vatPct: 21,
          },
        ],
      }),
    );
    expect(xml).toContain('&lt;20mm&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;L&quot;');
    expect(xml).not.toContain('<20mm>');
  });

  it('incluye la huella VeriFactu como extensión propia', () => {
    const xml = buildFacturaeXml(
      baseInput({
        verifactu: {
          hash: 'huella-actual',
          previousHash: 'huella-anterior',
          generatedAt: '2026-09-15T10:00:00.000Z',
        },
      }),
    );
    expect(xml).toContain('<Hash>huella-actual</Hash>');
    expect(xml).toContain('<PreviousHash>huella-anterior</PreviousHash>');
  });
});

describe('verifactuCanonicalString', () => {
  it('reordena la fecha a DD-MM-AAAA', () => {
    const s = verifactuCanonicalString(
      {
        issuerTaxId: 'B12345678',
        invoiceNumber: 'V-0001',
        issueDate: '2026-09-15',
        vatAmount: 210,
        totalAmount: 1210,
        generatedAt: '2026-09-15T10:00:00.000Z',
      },
      VERIFACTU_GENESIS_HASH,
    );
    expect(s).toContain('FechaExpedicionFactura=15-09-2026');
  });

  it('es determinista: mismos datos y misma huella anterior → misma cadena', () => {
    const record = {
      issuerTaxId: 'B12345678',
      invoiceNumber: 'V-0001',
      issueDate: '2026-09-15',
      vatAmount: 210,
      totalAmount: 1210,
      generatedAt: '2026-09-15T10:00:00.000Z',
    };
    expect(verifactuCanonicalString(record, 'abc')).toBe(
      verifactuCanonicalString(record, 'abc'),
    );
  });

  it('cambia si cambia la huella anterior (efecto cadena)', () => {
    const record = {
      issuerTaxId: 'B12345678',
      invoiceNumber: 'V-0001',
      issueDate: '2026-09-15',
      vatAmount: 210,
      totalAmount: 1210,
      generatedAt: '2026-09-15T10:00:00.000Z',
    };
    expect(verifactuCanonicalString(record, 'abc')).not.toBe(
      verifactuCanonicalString(record, 'def'),
    );
  });

  it('el primer registro de la cadena usa la huella génesis (vacía)', () => {
    const s = verifactuCanonicalString(
      {
        issuerTaxId: 'B12345678',
        invoiceNumber: 'V-0001',
        issueDate: '2026-09-15',
        vatAmount: 210,
        totalAmount: 1210,
        generatedAt: '2026-09-15T10:00:00.000Z',
      },
      VERIFACTU_GENESIS_HASH,
    );
    expect(s).toContain('Huella=&');
  });

  it('formatea los importes con dos decimales', () => {
    const s = verifactuCanonicalString(
      {
        issuerTaxId: 'B12345678',
        invoiceNumber: 'V-0001',
        issueDate: '2026-09-15',
        vatAmount: 210.5,
        totalAmount: 1210,
        generatedAt: '2026-09-15T10:00:00.000Z',
      },
      '',
    );
    expect(s).toContain('CuotaTotal=210.50');
    expect(s).toContain('ImporteTotal=1210.00');
  });
});

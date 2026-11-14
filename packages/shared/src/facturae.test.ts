import { describe, expect, it } from 'vitest';
import {
  FACTURAE_CORRECTION_METHODS,
  FACTURAE_NAMESPACE,
  FACTURAE_REASON_CODES,
  FACTURAE_UNKNOWN_ADDRESS,
  VERIFACTU_GENESIS_HASH,
  buildFacturaeXml,
  correctionMethodFromType,
  facturaeTaxPeriodOf,
  verifactuCanonicalString,
  type FacturaeCorrectionMethod,
  type FacturaeCorrectiveInput,
  type FacturaeInvoiceInput,
  type FacturaeReasonCode,
} from './facturae';
import { ISP_LEGEND } from './invoices';
import {
  FACTURAE_XSD_FILE,
  readXsdFile,
  validateFacturaeXsd,
} from './test-helpers/xsd';

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

  it('deja rastro de la huella en InvoiceAdditionalInformation, no en Extensions', () => {
    const xml = buildFacturaeXml(
      baseInput({
        verifactu: {
          hash: 'huella-actual',
          previousHash: 'huella-anterior',
          generatedAt: '2026-09-15T10:00:00.000Z',
        },
      }),
    );
    expect(xml).not.toContain('<Extensions>');
    expect(xml).not.toContain('VeriFactuHashPreliminar');
    expect(xml).toContain('<InvoiceAdditionalInformation>');
    expect(xml).toContain('huella-actual');
    expect(xml).toContain('huella-anterior');
  });

  it('usa el namespace oficial del XSD de Facturae 3.2.2', () => {
    const xml = buildFacturaeXml(baseInput());
    expect(FACTURAE_NAMESPACE).toBe(
      'http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml',
    );
    expect(xml).toContain(`xmlns:fe="${FACTURAE_NAMESPACE}"`);
  });
});

describe('buildFacturaeXml — conformidad con el XSD oficial 3.2.2', () => {
  const variantes: Array<[string, Partial<FacturaeInvoiceInput>]> = [
    ['normal', {}],
    [
      'ISP',
      {
        isp: true,
        vatAmount: 0,
        retentionAmount: 0,
        retentionPct: 0,
        totalAmount: 1000,
      },
    ],
    ['con retención', { retentionPct: 5, retentionAmount: 50 }],
    [
      'con varios tipos de IVA',
      {
        lines: [
          { description: 'Material', baseAmount: 500, vatPct: 21 },
          { description: 'Mano de obra', baseAmount: 300, vatPct: 21 },
          { description: 'Alimentación obra', baseAmount: 100, vatPct: 10 },
          { description: 'Libros', baseAmount: 100, vatPct: 4 },
        ],
        baseAmount: 1000,
        vatAmount: 182,
        totalAmount: 1182,
      },
    ],
  ];

  it.each(variantes)(
    'la factura %s valida contra el XSD (0 errores)',
    async (_nombre, overrides) => {
      const r = await validateFacturaeXsd(
        buildFacturaeXml(baseInput(overrides)),
      );
      expect(r.errors).toEqual([]);
      expect(r.valid).toBe(true);
    },
  );
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

/* ───────────────────────── Rectificativa (Corrective) ───────────────────────── */

describe('correctionMethodFromType', () => {
  it('S (sustitución) -> 01 íntegra; I (diferencias) -> 02', () => {
    expect(correctionMethodFromType('S')).toBe('01');
    expect(correctionMethodFromType('I')).toBe('02');
  });
});

describe('facturaeTaxPeriodOf', () => {
  it('devuelve el trimestre natural de la fecha de la factura original', () => {
    expect(facturaeTaxPeriodOf('2026-08-15')).toEqual({
      start: '2026-07-01',
      end: '2026-09-30',
    });
    expect(facturaeTaxPeriodOf('2026-02-10')).toEqual({
      start: '2026-01-01',
      end: '2026-03-31',
    });
  });
});

describe('literales del XSD', () => {
  const xsd = readXsdFile(FACTURAE_XSD_FILE);
  const enumeraciones = (tipo: string): string[] => {
    const bloque = xsd.slice(xsd.indexOf(`<xs:simpleType name="${tipo}">`));
    const cuerpo = bloque.slice(0, bloque.indexOf('</xs:simpleType>'));
    return [...cuerpo.matchAll(/<xs:enumeration value="([^"]*)"/g)].map(
      (m) => m[1],
    );
  };

  it('FACTURAE_REASON_CODES coincide con ReasonCodeType y ReasonDescriptionType', () => {
    // Los códigos y las descripciones del XSD van emparejados por posición.
    const codigos = enumeraciones('ReasonCodeType');
    const descripciones = enumeraciones('ReasonDescriptionType');
    expect(codigos).toHaveLength(22);
    expect(FACTURAE_REASON_CODES).toEqual(
      Object.fromEntries(codigos.map((c, i) => [c, descripciones[i]])),
    );
  });

  it('FACTURAE_CORRECTION_METHODS coincide con CorrectionMethodType y su descripción', () => {
    expect(Object.keys(FACTURAE_CORRECTION_METHODS)).toEqual(
      enumeraciones('CorrectionMethodType'),
    );
    expect(Object.values(FACTURAE_CORRECTION_METHODS)).toEqual(
      enumeraciones('CorrectionMethodDescriptionType'),
    );
  });
});

describe('buildFacturaeXml — rectificativa', () => {
  const corrective: FacturaeCorrectiveInput = {
    originalNumber: 'V-2026-0001',
    originalSeries: 'A',
    originalIssueDate: '2026-09-15',
    reasonCode: '16',
    correctionMethod: '01',
    taxPeriod: { start: '2026-07-01', end: '2026-09-30' },
    additionalReason: 'Importe mal certificado & revisado',
  };
  const negativa = (method: '01' | '02'): Partial<FacturaeInvoiceInput> => ({
    invoiceNumber: 'R-2026-0001',
    issueDate: '2026-10-05',
    lines: [
      { description: 'Abono certificación', baseAmount: -1000, vatPct: 21 },
    ],
    baseAmount: -1000,
    vatAmount: -210,
    retentionPct: 0,
    retentionAmount: 0,
    totalAmount: -1210,
    corrective: { ...corrective, correctionMethod: method },
  });

  it.each(['01', '02'] as const)(
    'valida contra el XSD con importes negativos (método %s)',
    async (method) => {
      const xml = buildFacturaeXml(baseInput(negativa(method)));
      const r = await validateFacturaeXsd(xml);
      expect(r.errors).toEqual([]);
      expect(xml).toContain('<InvoiceClass>OR</InvoiceClass>');
      expect(xml).toContain(`<CorrectionMethod>${method}</CorrectionMethod>`);
      expect(xml).toContain('<InvoiceTotal>-1210.00</InvoiceTotal>');
    },
  );

  it('coloca Corrective tras InvoiceClass y en el orden del XSD', () => {
    const xml = buildFacturaeXml(baseInput(negativa('01')));
    const orden = [
      '<InvoiceClass>',
      '<Corrective>',
      '<InvoiceNumber>V-2026-0001',
      '<InvoiceSeriesCode>A<',
      '<ReasonCode>16<',
      '<ReasonDescription>Base imponible<',
      '<TaxPeriod>',
      '<StartDate>2026-07-01',
      '<EndDate>2026-09-30',
      '<CorrectionMethod>01<',
      '<CorrectionMethodDescription>Rectificación íntegra<',
      '<AdditionalReasonDescription>Importe mal certificado &amp; revisado<',
      '<InvoiceIssueDate>2026-09-15<',
      '</Corrective>',
      '</InvoiceHeader>',
    ].map((t) => xml.indexOf(t));
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it('sin corrective emite OO y ningún bloque Corrective', () => {
    const xml = buildFacturaeXml(baseInput());
    expect(xml).toContain('<InvoiceClass>OO</InvoiceClass>');
    expect(xml).not.toContain('Corrective');
  });

  it('omite serie y ampliación cuando no se informan, y sigue validando', async () => {
    const xml = buildFacturaeXml(
      baseInput({
        corrective: {
          ...corrective,
          originalSeries: undefined,
          additionalReason: undefined,
        },
      }),
    );
    expect(xml).not.toContain('<InvoiceSeriesCode>');
    expect(xml).not.toContain('<AdditionalReasonDescription>');
    expect((await validateFacturaeXsd(xml)).errors).toEqual([]);
  });

  it.each(Object.entries(FACTURAE_REASON_CODES))(
    'valida el par código/descripción %s "%s"',
    async (code, description) => {
      const xml = buildFacturaeXml(
        baseInput({
          corrective: {
            ...corrective,
            reasonCode: code as FacturaeReasonCode,
            reasonDescription: description,
          },
        }),
      );
      const r = await validateFacturaeXsd(xml);
      expect(r.errors).toEqual([]);
      expect(xml).toContain(`<ReasonCode>${code}</ReasonCode>`);
    },
  );

  it('error claro si originalNumber supera 20 caracteres', () => {
    expect(() =>
      buildFacturaeXml(
        baseInput({
          corrective: { ...corrective, originalNumber: 'X'.repeat(21) },
        }),
      ),
    ).toThrow(/número de la factura rectificada supera el máximo de 20/);
  });

  it('acepta originalNumber de exactamente 20 caracteres', () => {
    expect(() =>
      buildFacturaeXml(
        baseInput({
          corrective: { ...corrective, originalNumber: 'X'.repeat(20) },
        }),
      ),
    ).not.toThrow();
  });

  it('rechaza una descripción que no corresponde al código', () => {
    expect(() =>
      buildFacturaeXml(
        baseInput({
          corrective: {
            ...corrective,
            reasonCode: '16',
            reasonDescription: 'Fecha expedición',
          },
        }),
      ),
    ).toThrow(/no corresponde al código 16/);
  });

  it('rechaza código de motivo, criterio, fechas y periodo inválidos', () => {
    const build = (o: Partial<FacturaeCorrectiveInput>) => () =>
      buildFacturaeXml(baseInput({ corrective: { ...corrective, ...o } }));
    expect(build({ reasonCode: '99' as FacturaeReasonCode })).toThrow(
      /código de motivo no válido/,
    );
    expect(
      build({ correctionMethod: '03' as FacturaeCorrectionMethod }),
    ).toThrow(/criterio de rectificación no soportado/);
    expect(build({ originalIssueDate: '15/09/2026' })).toThrow(/fecha/);
    expect(
      build({ taxPeriod: { start: '2026-10-01', end: '2026-07-01' } }),
    ).toThrow(/termina antes de empezar/);
    expect(build({ originalNumber: '' })).toThrow(/obligatorio/);
    expect(build({ originalSeries: 'S'.repeat(21) })).toThrow(/serie/);
    expect(build({ additionalReason: 'a'.repeat(2501) })).toThrow(/2500/);
  });
});

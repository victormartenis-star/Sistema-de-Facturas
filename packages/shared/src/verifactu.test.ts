import { describe, expect, it } from 'vitest';
import { buildRegistroAltaXml, type RegistroAltaInput } from './verifactu';

const baseInput: RegistroAltaInput = {
  issuerTaxId: 'B12345678',
  issuerName: 'Constructora de Pruebas SL',
  invoiceNumber: 'F-2026-001',
  issueDate: '2026-09-16',
  vatAmount: 210,
  totalAmount: 1210,
  hash: 'HASHACTUAL',
  previousHash: 'HASHANTERIOR',
  generatedAt: '2026-09-16T10:00:00+02:00',
  softwareName: 'ERP Dintel',
  softwareVersion: '1.0',
};

describe('buildRegistroAltaXml', () => {
  it('genera un XML bien formado con los campos obligatorios del registro', () => {
    const xml = buildRegistroAltaXml(baseInput);
    expect(xml).toContain(
      '<sum:IDEmisorFactura>B12345678</sum:IDEmisorFactura>',
    );
    expect(xml).toContain(
      '<sum:NumSerieFactura>F-2026-001</sum:NumSerieFactura>',
    );
    expect(xml).toContain(
      '<sum:FechaExpedicionFactura>16-09-2026</sum:FechaExpedicionFactura>',
    );
    expect(xml).toContain('<sum:CuotaTotal>210.00</sum:CuotaTotal>');
    expect(xml).toContain('<sum:ImporteTotal>1210.00</sum:ImporteTotal>');
    expect(xml).toContain('<sum:Huella>HASHACTUAL</sum:Huella>');
    expect(xml).toContain('<sum:Huella>HASHANTERIOR</sum:Huella>');
    expect(xml).toContain('<sum:TipoFactura>F1</sum:TipoFactura>');
  });

  it('escapa caracteres especiales en el nombre del emisor', () => {
    const xml = buildRegistroAltaXml({
      ...baseInput,
      issuerName: 'Obras & Reformas "El Ñato" S.L.',
    });
    expect(xml).toContain('Obras &amp; Reformas &quot;El Ñato&quot; S.L.');
    expect(xml).not.toContain('Obras & Reformas "El Ñato"');
  });

  it('es determinista: mismos datos, mismo XML', () => {
    expect(buildRegistroAltaXml(baseInput)).toBe(
      buildRegistroAltaXml(baseInput),
    );
  });
});

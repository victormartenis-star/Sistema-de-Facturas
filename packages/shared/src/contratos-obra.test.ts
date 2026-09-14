import { describe, expect, it } from 'vitest';
import { validarFirmaContrato } from './contratos-obra';

describe('validarFirmaContrato', () => {
  it('sin errores cuando hay PDF y fecha de firma', () => {
    expect(
      validarFirmaContrato({ documentId: 'doc-1', fechaFirma: '2026-09-14' }),
    ).toEqual([]);
  });

  it('exige el PDF adjunto', () => {
    const errores = validarFirmaContrato({
      documentId: null,
      fechaFirma: '2026-09-14',
    });
    expect(errores).toHaveLength(1);
    expect(errores[0]).toMatch(/PDF/);
  });

  it('exige la fecha de firma', () => {
    const errores = validarFirmaContrato({
      documentId: 'doc-1',
      fechaFirma: null,
    });
    expect(errores).toHaveLength(1);
    expect(errores[0]).toMatch(/fecha de firma/);
  });

  it('acumula ambos motivos si faltan los dos', () => {
    expect(
      validarFirmaContrato({ documentId: null, fechaFirma: null }),
    ).toHaveLength(2);
  });
});

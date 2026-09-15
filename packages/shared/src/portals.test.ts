import { describe, expect, it } from 'vitest';
import {
  computeAvancePct,
  portalFacturaSubmissionCreateSchema,
} from './portals';

describe('portalFacturaSubmissionCreateSchema', () => {
  it('rechaza un importe cero o negativo', () => {
    expect(() =>
      portalFacturaSubmissionCreateSchema.parse({
        documentId: '11111111-1111-1111-1111-111111111111',
        numeroFacturaDeclarado: 'F-2026-001',
        fechaDeclarada: '2026-09-14',
        importeDeclarado: 0,
      }),
    ).toThrow();
  });

  it('acepta un alta mínima válida', () => {
    const result = portalFacturaSubmissionCreateSchema.parse({
      documentId: '11111111-1111-1111-1111-111111111111',
      numeroFacturaDeclarado: 'F-2026-001',
      fechaDeclarada: '2026-09-14',
      importeDeclarado: 1250.5,
    });
    expect(result.importeDeclarado).toBe(1250.5);
  });
});

describe('computeAvancePct', () => {
  it('calcula el % certificado sobre el presupuesto', () => {
    expect(computeAvancePct(50_000, 200_000)).toBe(25);
  });

  it('devuelve null sin presupuesto', () => {
    expect(computeAvancePct(1000, 0)).toBeNull();
  });
});

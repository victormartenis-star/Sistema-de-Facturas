import { describe, expect, it } from 'vitest';
import {
  CertSubcontrataInvalidaError,
  computeCertSubcontrata,
  motivoDevolucionInvalida,
  resumenRetencionGarantia,
} from './calculo';
import {
  canTransitionCertSubcontrata,
  certSubcontrataCreateSchema,
  certSubcontrataUpdateSchema,
  devolucionGarantiaCreateSchema,
  esCertSubcontrataVigente,
} from './certificaciones-subcontrata';

describe('computeCertSubcontrata', () => {
  it('primera certificación: periodo = a origen, retención y líquido', () => {
    const r = computeCertSubcontrata(100_000, 25_000, 0, 5);
    expect(r).toEqual({
      importeOrigen: 25_000,
      importeAnterior: 0,
      importePeriodo: 25_000,
      retencionImporte: 1_250,
      importeLiquido: 23_750,
      pctEjecutado: 25,
    });
  });

  it('a origen: el periodo es la diferencia con lo ya certificado', () => {
    const r = computeCertSubcontrata(100_000, 60_000, 25_000, 5);
    expect(r.importePeriodo).toBe(35_000);
    expect(r.retencionImporte).toBe(1_750);
    expect(r.importeLiquido).toBe(33_250);
    expect(r.pctEjecutado).toBe(60);
  });

  it('redondea la retención half-up en céntimos y cuadra periodo = retención + líquido', () => {
    const r = computeCertSubcontrata(10_000, 333.33, 0, 5);
    expect(r.retencionImporte).toBe(16.67);
    expect(r.importeLiquido).toBe(316.66);
    expect(Math.round((r.retencionImporte + r.importeLiquido) * 100)).toBe(
      Math.round(r.importePeriodo * 100),
    );
    expect(r.pctEjecutado).toBe(3.33);
  });

  it('sin retención el líquido es el periodo', () => {
    const r = computeCertSubcontrata(1_000, 1_000, 400, 0);
    expect(r.retencionImporte).toBe(0);
    expect(r.importeLiquido).toBe(600);
    expect(r.pctEjecutado).toBe(100);
  });

  it('rechaza superar el contrato, bajar del anterior, negativos y periodos a cero', () => {
    expect(() => computeCertSubcontrata(1_000, 1_000.01, 0, 5)).toThrow(
      CertSubcontrataInvalidaError,
    );
    expect(() => computeCertSubcontrata(1_000, 400, 500, 5)).toThrow(
      /anula la última/,
    );
    expect(() => computeCertSubcontrata(1_000, -1, 0, 5)).toThrow(/negativo/);
    expect(() => computeCertSubcontrata(1_000, 500, 500, 5)).toThrow(
      /no tiene producción/,
    );
  });
});

describe('resumenRetencionGarantia y devoluciones', () => {
  it('suma en céntimos: retenido, devuelto y pendiente', () => {
    expect(resumenRetencionGarantia([0.1, 0.2, 1_250], [0.3])).toEqual({
      retenido: 1_250.3,
      devuelto: 0.3,
      pendiente: 1_250,
    });
    expect(resumenRetencionGarantia([], [])).toEqual({
      retenido: 0,
      devuelto: 0,
      pendiente: 0,
    });
  });

  it('una devolución debe ser positiva y no superar lo pendiente', () => {
    expect(motivoDevolucionInvalida(100, 100)).toBeNull();
    expect(motivoDevolucionInvalida(100.01, 100)).toMatch(/supera/);
    expect(motivoDevolucionInvalida(0, 100)).toMatch(/mayor que 0/);
  });
});

describe('estados de la certificación de subcontrata', () => {
  it('pagada y anulada son terminales; aprobada puede pagarse o anularse', () => {
    expect(canTransitionCertSubcontrata('borrador', 'aprobada')).toBe(true);
    expect(canTransitionCertSubcontrata('borrador', 'pagada')).toBe(false);
    expect(canTransitionCertSubcontrata('aprobada', 'pagada')).toBe(true);
    expect(canTransitionCertSubcontrata('aprobada', 'anulada')).toBe(true);
    expect(canTransitionCertSubcontrata('pagada', 'anulada')).toBe(false);
    expect(canTransitionCertSubcontrata('anulada', 'borrador')).toBe(false);
  });

  it('solo aprobadas y pagadas cuentan como producción certificada', () => {
    expect(esCertSubcontrataVigente('aprobada')).toBe(true);
    expect(esCertSubcontrataVigente('pagada')).toBe(true);
    expect(esCertSubcontrataVigente('borrador')).toBe(false);
    expect(esCertSubcontrataVigente('anulada')).toBe(false);
  });
});

describe('esquemas de entrada', () => {
  const base = {
    fecha: '2026-11-30',
    periodoDesde: '2026-11-01',
    periodoHasta: '2026-11-30',
    importeOrigen: 1_234.5,
  };

  it('acepta una certificación válida y rechaza campos desconocidos', () => {
    expect(certSubcontrataCreateSchema.safeParse(base).success).toBe(true);
    expect(
      certSubcontrataCreateSchema.safeParse({ ...base, retencionPct: 0 })
        .success,
    ).toBe(false);
  });

  it('rechaza periodos invertidos y más de dos decimales', () => {
    expect(
      certSubcontrataCreateSchema.safeParse({
        ...base,
        periodoDesde: '2026-12-01',
      }).success,
    ).toBe(false);
    expect(
      certSubcontrataCreateSchema.safeParse({ ...base, importeOrigen: 0.001 })
        .success,
    ).toBe(false);
    expect(
      certSubcontrataCreateSchema.safeParse({ ...base, importeOrigen: 0.1 })
        .success,
    ).toBe(true);
  });

  it('la edición exige al menos un cambio', () => {
    expect(certSubcontrataUpdateSchema.safeParse({}).success).toBe(false);
    expect(
      certSubcontrataUpdateSchema.safeParse({ importeOrigen: 10 }).success,
    ).toBe(true);
  });

  it('la devolución exige importe positivo y motivo', () => {
    expect(
      devolucionGarantiaCreateSchema.safeParse({
        fecha: '2027-01-15',
        importe: 0,
        motivo: 'Fin del plazo de garantía',
      }).success,
    ).toBe(false);
    expect(
      devolucionGarantiaCreateSchema.safeParse({
        fecha: '2027-01-15',
        importe: 500,
        motivo: 'Fin del plazo de garantía',
      }).success,
    ).toBe(true);
  });
});

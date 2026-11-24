import { describe, expect, it } from 'vitest';
import { asientoProvisionPerdidas, calcularProvisionPerdidas } from './calculo';
import { tipoCuentaPorCodigo } from './contabilidad';

const base = {
  contrato: '100000.00',
  produccion: '40000.00',
  costeReal: '40000.00',
  provisionAnterior: 0,
};

describe('calcularProvisionPerdidas', () => {
  it('obra rentable: sin provisión', () => {
    expect(
      calcularProvisionPerdidas({ ...base, costeEstimadoCierre: 90000 }),
    ).toMatchObject({ perdidaTotal: 0, provisionNecesaria: 0, ajuste: 0 });
  });

  it('pérdida prevista: se provisiona entera menos lo ya reconocido', () => {
    // Coste estimado 112.000 > contrato 100.000: pérdida 12.000. Ya
    // reconocidos 2.000 (coste real 42.000 − producción 40.000).
    expect(
      calcularProvisionPerdidas({
        ...base,
        costeReal: '42000.00',
        costeEstimadoCierre: '112000.00',
      }),
    ).toMatchObject({
      perdidaTotal: 12000,
      perdidaReconocida: 2000,
      provisionNecesaria: 10000,
      ajuste: 10000,
    });
  });

  it('ajuste incremental y reversión cuando mejora (céntimos exactos)', () => {
    const r = calcularProvisionPerdidas({
      ...base,
      costeEstimadoCierre: '100500.10',
      provisionAnterior: '10000.00',
    });
    expect(r).toMatchObject({ provisionNecesaria: 500.1, ajuste: -9499.9 });
  });

  it('obra terminada o sin contrato: provisión 0', () => {
    expect(
      calcularProvisionPerdidas({
        ...base,
        costeEstimadoCierre: 150000,
        provisionAnterior: 3000,
        obraTerminada: true,
      }).ajuste,
    ).toBe(-3000);
    expect(
      calcularProvisionPerdidas({
        ...base,
        contrato: null,
        costeEstimadoCierre: 150000,
      }).provisionNecesaria,
    ).toBe(0);
  });
});

describe('asientoProvisionPerdidas', () => {
  it('dotación 6954 (obra) a 4994; exceso 4994 a 7954 (obra); sin ajuste, vacío', () => {
    expect(asientoProvisionPerdidas(10000)).toEqual([
      { cuenta: '6954', debe: '10000.00', haber: '0.00', imputaObra: true },
      { cuenta: '4994', debe: '0.00', haber: '10000.00', imputaObra: false },
    ]);
    expect(asientoProvisionPerdidas('-9499.90')).toEqual([
      { cuenta: '4994', debe: '9499.90', haber: '0.00', imputaObra: false },
      { cuenta: '7954', debe: '0.00', haber: '9499.90', imputaObra: true },
    ]);
    expect(asientoProvisionPerdidas(0)).toEqual([]);
  });

  it('499x (provisiones comerciales) es pasivo', () => {
    expect(tipoCuentaPorCodigo('4994')).toBe('pasivo');
  });
});

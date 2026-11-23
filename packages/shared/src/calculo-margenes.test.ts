import { describe, expect, it } from 'vitest';
import {
  cobradoEnBase,
  comprometidoPendiente,
  cuadroMargenesObra,
  evaluarControlPresupuestario,
  margenPorPartida,
  sumarEntradasCuadro,
  type EntradaCuadroMargenes,
} from './calculo';

const base: EntradaCuadroMargenes = {
  contrato: '120000.00',
  presupuestado: '100000.00',
  comprometido: { pedidos: '15000.00', subcontratas: '5000.00' },
  costeReal: {
    facturasCompra: '40000.10',
    partesPersonal: '10000.20',
    partesMaquinaria: '4999.70',
    almacen: '3000.00',
    amortizacion: '2000.00',
  },
  certificado: '80000.00',
  facturado: '70000.00',
  cobrado: '50000.00',
};

describe('comprometidoPendiente', () => {
  it('resta lo ejecutado por compromiso y nunca deja negativo', () => {
    expect(
      comprometidoPendiente([
        { importe: '1000.00', ejecutado: '400.00' },
        { importe: '500', ejecutado: '800' }, // sobreejecutado: 0, no −300
        { importe: 0.1, ejecutado: 0 },
      ]),
    ).toBe(600.1);
    expect(comprometidoPendiente([])).toBe(0);
  });
});

describe('cobradoEnBase', () => {
  it('prorratea lo liquidado a la base de la obra, exacto al céntimo', () => {
    // Factura 1.210 € (1.000 base + IVA) cobrada a medias → 500 € de base.
    expect(
      cobradoEnBase([
        { baseObra: '1000', totalVencimientos: '1210', liquidado: '605' },
      ]),
    ).toBe(500);
    // Factura repartida: la obra tiene 1/3 de la base.
    expect(
      cobradoEnBase([
        { baseObra: '100', totalVencimientos: '363', liquidado: '363' },
        { baseObra: '10', totalVencimientos: '0', liquidado: '0' },
      ]),
    ).toBe(100);
  });
  it('una rectificativa cobrada (negativa) resta', () => {
    expect(
      cobradoEnBase([
        { baseObra: '1000', totalVencimientos: '1210', liquidado: '1210' },
        { baseObra: '-100', totalVencimientos: '-121', liquidado: '-121' },
      ]),
    ).toBe(900);
  });
});

describe('cuadroMargenesObra', () => {
  it('consolida real, comprometido, desviación y márgenes en céntimos', () => {
    const c = cuadroMargenesObra(base);
    expect(c.costeReal).toBe(60000);
    expect(c.comprometido).toBe(20000);
    expect(c.consumido).toBe(80000);
    expect(c.consumoPct).toBe(80);
    expect(c.desviacion).toBe(20000);
    expect(c.desviacionPct).toBe(20);
    expect(c.costeEstimadoCierre).toBe(100000);
    expect(c.margenPrevisto).toBe(20000);
    expect(c.margenPrevistoPct).toBe(16.67);
    expect(c.margenProyectado).toBe(20000);
    expect(c.margenReal).toBe(20000);
    expect(c.margenRealPct).toBe(25);
    expect(c.pendienteCertificar).toBe(40000);
    expect(c.pendienteFacturar).toBe(10000);
    expect(c.pendienteCobro).toBe(20000);
    expect(c.costeRealDesglose.almacen).toBe(3000);
  });

  it('sobrecoste: el coste al cierre es el consumido y la desviación negativa', () => {
    const c = cuadroMargenesObra({
      ...base,
      comprometido: { pedidos: '50000', subcontratas: '0' },
    });
    expect(c.consumido).toBe(110000);
    expect(c.desviacion).toBe(-10000);
    expect(c.costeEstimadoCierre).toBe(110000);
    expect(c.margenProyectado).toBe(10000);
  });

  it('sin contrato ni presupuesto: márgenes y porcentajes nulos', () => {
    const c = cuadroMargenesObra({
      ...base,
      contrato: null,
      presupuestado: 0,
      certificado: 0,
    });
    expect(c.margenPrevisto).toBeNull();
    expect(c.pendienteCertificar).toBeNull();
    expect(c.consumoPct).toBeNull();
    expect(c.margenRealPct).toBeNull();
  });

  it('los totales de cartera suman céntimos exactos (0,1 + 0,2 = 0,3)', () => {
    const a = { ...base, costeReal: { ...base.costeReal, almacen: 0.1 } };
    const b = {
      ...base,
      contrato: null,
      costeReal: { ...base.costeReal, almacen: 0.2 },
    };
    const t = sumarEntradasCuadro([a, b]);
    expect(t.costeReal.almacen).toBe('0.30');
    expect(t.contrato).toBe('120000.00');
    expect(cuadroMargenesObra(t).presupuestado).toBe(200000);
  });
});

describe('margenPorPartida', () => {
  it('marca partidas excedidas y agrega por capítulo', () => {
    const { partidas, capitulos } = margenPorPartida([
      {
        phaseId: 'a',
        codigo: '01.01',
        nombre: 'Excavación',
        capitulo: '01',
        presupuestado: 100,
        comprometido: 30,
        costeReal: 80,
      },
      {
        phaseId: 'b',
        codigo: '01.02',
        nombre: 'Relleno',
        capitulo: '01',
        presupuestado: 50,
        comprometido: 0,
        costeReal: 10,
      },
      {
        phaseId: null,
        codigo: '',
        nombre: 'Sin partida',
        capitulo: null,
        presupuestado: 0,
        comprometido: 0,
        costeReal: 5,
      },
    ]);
    expect(partidas[0]).toMatchObject({
      consumido: 110,
      desviacion: -10,
      excedida: true,
    });
    expect(partidas[1].excedida).toBe(false);
    expect(partidas[2].consumoPct).toBeNull();
    expect(capitulos).toEqual([
      expect.objectContaining({
        capitulo: '01',
        presupuestado: 150,
        consumido: 120,
        excedido: false,
      }),
    ]);
  });
});

describe('evaluarControlPresupuestario', () => {
  const cfg = {
    toleranciaPct: 5,
    umbralAvisoPct: 90,
    presupuestado: '1000.00',
  };

  it('dentro del umbral: ok; superado el umbral: aviso', () => {
    expect(
      evaluarControlPresupuestario({
        ...cfg,
        modo: 'bloqueo',
        consumido: 800,
        importe: 50,
      }).estado,
    ).toBe('ok');
    const r = evaluarControlPresupuestario({
      ...cfg,
      modo: 'bloqueo',
      consumido: 800,
      importe: 150,
    });
    expect(r).toMatchObject({
      estado: 'aviso',
      bloquea: false,
      limite: 1050,
      disponible: 100,
    });
  });

  it('modo bloqueo: rechaza al superar presupuesto + tolerancia y calcula el exceso', () => {
    const r = evaluarControlPresupuestario({
      ...cfg,
      modo: 'bloqueo',
      consumido: 1000,
      importe: 100.01,
    });
    expect(r).toMatchObject({
      estado: 'excedido',
      bloquea: true,
      avisa: false,
      consumidoTras: 1100.01,
      exceso: 50.01,
      disponible: -50.01,
    });
  });

  it('justo en el límite no excede', () => {
    expect(
      evaluarControlPresupuestario({
        ...cfg,
        modo: 'bloqueo',
        consumido: 1000,
        importe: 50,
      }).bloquea,
    ).toBe(false);
  });

  it('modo aviso permite y avisa; observación solo informa', () => {
    const a = evaluarControlPresupuestario({
      ...cfg,
      modo: 'aviso',
      consumido: 2000,
      importe: 1,
    });
    expect(a).toMatchObject({
      estado: 'excedido',
      bloquea: false,
      avisa: true,
    });
    const o = evaluarControlPresupuestario({
      ...cfg,
      modo: 'observacion',
      consumido: 2000,
      importe: 1,
    });
    expect(o).toMatchObject({
      estado: 'excedido',
      bloquea: false,
      avisa: false,
    });
  });

  it('una operación que no añade coste nunca bloquea; sin presupuesto no se controla', () => {
    expect(
      evaluarControlPresupuestario({ ...cfg, modo: 'bloqueo', consumido: 5000 })
        .bloquea,
    ).toBe(false);
    expect(
      evaluarControlPresupuestario({
        ...cfg,
        modo: 'bloqueo',
        presupuestado: 0,
        consumido: 0,
        importe: 999,
      }),
    ).toMatchObject({ estado: 'sin_presupuesto', bloquea: false });
  });
});

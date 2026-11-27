import { describe, expect, it } from 'vitest';
import {
  CUENTA_DIFERENCIAS_CONVERSION,
  consolidarEstados,
  convertirImporte,
  convertirSaldosMoneda,
  eliminacionInversionPatrimonio,
  patrimonioNetoDeSaldos,
  seleccionarTipoCambio,
  tipoCambioDeCuenta,
  type AjusteConsolidacion,
  type InversionPatrimonioEntrada,
  type SaldoCuenta,
  type TipoCambioRegistro,
} from './calculo';
import { toCents } from './dinero';
import {
  miembroCreateSchema,
  sociedadCreateSchema,
  tipoCambioCreateSchema,
} from './consolidacion';

/** Suma en céntimos de debe − haber de un ajuste (0 si cuadra). */
const cuadre = (a: AjusteConsolidacion) =>
  a.lineas.reduce((s, l) => s + toCents(l.debe) - toCents(l.haber), 0n);
const linea = (a: AjusteConsolidacion, cuenta: string) =>
  a.lineas.find((l) => l.cuenta === cuenta);

describe('conversión de moneda extranjera (CTA)', () => {
  // Filial en USD: 1 USD = 0,90 EUR al cierre, 0,95 de media y 0,80 histórico.
  const saldosUsd: SaldoCuenta[] = [
    { codigo: '2130', saldoDeudor: '1000.00' },
    { codigo: '1000', saldoDeudor: '-600.00' },
    { codigo: '1700', saldoDeudor: '-300.00' },
    { codigo: '7050', saldoDeudor: '-500.00' },
    { codigo: '6000', saldoDeudor: '400.00' },
  ];
  const tipos = { cierre: 0.9, medio: 0.95, historico: 0.8 };

  it('aplica cierre a balance, medio a PyG e histórico a patrimonio', () => {
    expect(tipoCambioDeCuenta('2130')).toBe('cierre');
    expect(tipoCambioDeCuenta('1700')).toBe('cierre');
    expect(tipoCambioDeCuenta('4000')).toBe('cierre');
    expect(tipoCambioDeCuenta('1000')).toBe('historico');
    expect(tipoCambioDeCuenta('7050')).toBe('medio');
    expect(tipoCambioDeCuenta('6000')).toBe('medio');
  });

  it('calcula la diferencia de conversión y el balance convertido cuadra', () => {
    const r = convertirSaldosMoneda(saldosUsd, tipos);
    const por = new Map(r.saldos.map((s) => [s.codigo, Number(s.saldoDeudor)]));
    expect(por.get('2130')).toBe(900);
    expect(por.get('1000')).toBe(-480);
    expect(por.get('1700')).toBe(-270);
    expect(por.get('7050')).toBe(-475);
    expect(por.get('6000')).toBe(380);
    // 900 − 480 − 270 − 475 + 380 = 55 de descuadre → CTA de 55 al haber.
    expect(por.get(CUENTA_DIFERENCIAS_CONVERSION)).toBe(-55);
    expect(r.diferenciaConversion).toBe(55);
    const suma = r.saldos.reduce((s, x) => s + toCents(x.saldoDeudor), 0n);
    expect(suma).toBe(0n);
    expect(r.porMasa.find((m) => m.masa === 'patrimonio')).toEqual({
      masa: 'patrimonio',
      tipo: 'historico',
      original: 600,
      convertido: 480,
    });
  });

  it('CTA negativa cuando la moneda se deprecia y sin línea si no hay diferencia', () => {
    const r = convertirSaldosMoneda(saldosUsd, {
      cierre: 0.7,
      medio: 0.75,
      historico: 0.8,
    });
    expect(r.diferenciaConversion).toBeLessThan(0);
    const mismo = convertirSaldosMoneda(saldosUsd, {
      cierre: 1.1,
      medio: 1.1,
      historico: 1.1,
    });
    expect(mismo.diferenciaConversion).toBe(0);
    expect(
      mismo.saldos.some((s) => s.codigo === CUENTA_DIFERENCIAS_CONVERSION),
    ).toBe(false);
  });

  it('sin pérdida de céntimos con tipos de 8 decimales (redondeo simétrico)', () => {
    expect(convertirImporte('100.00', '1.23456789')).toBe(123.46);
    expect(convertirImporte('-100.00', '1.23456789')).toBe(-123.46);
    expect(convertirImporte('0.01', '0.5')).toBe(0.01);
    expect(convertirImporte('-0.01', '0.5')).toBe(-0.01);
    // Muchos saldos con céntimos sueltos: el convertido siempre suma cero.
    const saldos: SaldoCuenta[] = [];
    let total = 0n;
    for (let i = 1; i <= 40; i++) {
      const c = BigInt(i * 1237 + 3);
      saldos.push({
        codigo: i % 2 ? '2130' : '6000',
        saldoDeudor: Number(c) / 100,
      });
      total += c;
    }
    saldos.push({ codigo: '1000', saldoDeudor: Number(-total) / 100 });
    const r = convertirSaldosMoneda(saldos, {
      cierre: '1.08371234',
      medio: '1.07219999',
      historico: '0.99999999',
    });
    expect(r.saldos.reduce((s, x) => s + toCents(x.saldoDeudor), 0n)).toBe(0n);
  });

  it('rechaza tipos de cambio no positivos', () => {
    expect(() =>
      convertirSaldosMoneda(saldosUsd, { ...tipos, medio: 0 }),
    ).toThrow(RangeError);
  });

  it('patrimonio neto y resultado de unos saldos', () => {
    expect(patrimonioNetoDeSaldos(saldosUsd)).toEqual({
      patrimonio: 600,
      resultado: 100,
    });
  });
});

describe('seleccionarTipoCambio', () => {
  const r: TipoCambioRegistro[] = [
    {
      moneda: 'USD',
      tipo: 'cierre',
      desde: '2025-12-31',
      hasta: '2025-12-31',
      tasa: 0.92,
    },
    {
      moneda: 'USD',
      tipo: 'cierre',
      desde: '2026-06-30',
      hasta: '2026-06-30',
      tasa: 0.9,
    },
    {
      moneda: 'USD',
      tipo: 'medio',
      desde: '2026-01-01',
      hasta: '2026-12-31',
      tasa: 0.95,
    },
    {
      moneda: 'USD',
      tipo: 'medio',
      desde: '2026-01-01',
      hasta: '2026-06-30',
      tasa: 0.93,
    },
    {
      moneda: 'GBP',
      tipo: 'cierre',
      desde: '2026-12-31',
      hasta: '2026-12-31',
      tasa: 1.15,
    },
    {
      moneda: 'USD',
      tipo: 'historico',
      desde: '2024-03-01',
      hasta: '2024-03-01',
      tasa: 0.8,
    },
  ];
  const q = (
    tipo: 'cierre' | 'medio' | 'historico',
    desde: string,
    hasta: string,
    moneda = 'USD',
  ) => seleccionarTipoCambio(r, { moneda, tipo, desde, hasta })?.tasa ?? null;

  it('cierre e histórico: el último con fecha ≤ la de referencia', () => {
    expect(q('cierre', '2026-01-01', '2026-12-31')).toBe(0.9);
    expect(q('cierre', '2026-01-01', '2026-03-31')).toBe(0.92);
    expect(q('cierre', '2025-01-01', '2025-06-30')).toBeNull();
    expect(q('historico', '2024-03-01', '2024-03-01')).toBe(0.8);
    expect(q('cierre', '2026-01-01', '2026-12-31', 'GBP')).toBe(1.15);
  });

  it('medio: periodo exacto o el más estrecho que lo cubra', () => {
    expect(q('medio', '2026-01-01', '2026-12-31')).toBe(0.95);
    expect(q('medio', '2026-01-01', '2026-06-30')).toBe(0.93);
    expect(q('medio', '2026-02-01', '2026-03-31')).toBe(0.93);
    expect(q('medio', '2026-02-01', '2026-09-30')).toBe(0.95);
    expect(q('medio', '2025-01-01', '2025-12-31')).toBeNull();
  });
});

describe('eliminacionInversionPatrimonio', () => {
  const base: InversionPatrimonioEntrada = {
    companyId: 'B',
    metodo: 'global',
    participacionPct: 80,
    costeInversion: 900,
    cuentaInversion: '2403',
    patrimonioAdquisicion: 1000,
    patrimonioCierre: 1200,
    resultadoPeriodo: 0,
    adquisicionEnPeriodo: true,
  };

  it('global 80 %: fondo de comercio y socios externos, cuadrado al céntimo', () => {
    const r = eliminacionInversionPatrimonio(base);
    expect(r).toMatchObject({
      participacionAdquirida: 800,
      fondoComercio: 100,
      diferenciaNegativa: 0,
      sociosExternosAdquisicion: 200,
      sociosExternosPosteriores: 40,
      valorPuestaEquivalencia: null,
    });
    const [elim, post] = r.ajustes;
    expect(cuadre(elim)).toBe(0n);
    expect(cuadre(post)).toBe(0n);
    expect(linea(elim, '1000')).toEqual({
      cuenta: '1000',
      debe: '1000.00',
      haber: '0.00',
    });
    expect(linea(elim, '2403')).toEqual({
      cuenta: '2403',
      debe: '0.00',
      haber: '900.00',
    });
    expect(linea(elim, '1160')?.haber).toBe('200.00');
    expect(linea(elim, '2040')?.debe).toBe('100.00');
    expect(linea(post, '1135')?.debe).toBe('40.00');
    expect(linea(post, '1160')?.haber).toBe('40.00');
  });

  it('diferencia negativa: a resultados en el año de adquisición y a reservas después', () => {
    const enPeriodo = eliminacionInversionPatrimonio({
      ...base,
      participacionPct: 100,
      costeInversion: 700,
      patrimonioCierre: 1000,
    });
    expect(enPeriodo.diferenciaNegativa).toBe(300);
    expect(enPeriodo.fondoComercio).toBe(0);
    expect(linea(enPeriodo.ajustes[0], '7740')?.haber).toBe('300.00');
    // 100 %: sin socios externos ni reclasificación posterior.
    expect(enPeriodo.ajustes).toHaveLength(1);
    const despues = eliminacionInversionPatrimonio({
      ...base,
      participacionPct: 100,
      costeInversion: 700,
      adquisicionEnPeriodo: false,
    });
    expect(linea(despues.ajustes[0], '7740')).toBeUndefined();
    expect(linea(despues.ajustes[0], '1135')?.haber).toBe('300.00');
  });

  it('proporcional 50 %: elimina solo la parte integrada, sin socios externos', () => {
    const r = eliminacionInversionPatrimonio({
      ...base,
      metodo: 'proporcional',
      participacionPct: 50,
      costeInversion: 600,
    });
    expect(r).toMatchObject({
      participacionAdquirida: 500,
      fondoComercio: 100,
      sociosExternosAdquisicion: 0,
      sociosExternosPosteriores: 0,
    });
    expect(linea(r.ajustes[0], '1000')?.debe).toBe('500.00');
    expect(r.ajustes).toHaveLength(1);
    expect(cuadre(r.ajustes[0])).toBe(0n);
  });

  it('puesta en equivalencia 30 %: coste + variación del PN + resultado', () => {
    const r = eliminacionInversionPatrimonio({
      ...base,
      metodo: 'puesta_equivalencia',
      participacionPct: 30,
      costeInversion: 400,
      patrimonioAdquisicion: 1000,
      patrimonioCierre: 1500,
      resultadoPeriodo: 200,
    });
    expect(r).toMatchObject({
      participacionAdquirida: 300,
      fondoComercio: 100,
      valorPuestaEquivalencia: 610,
      resultadoPuestaEquivalencia: 60,
    });
    for (const a of r.ajustes) expect(cuadre(a)).toBe(0n);
    expect(linea(r.ajustes[0], '2400')?.debe).toBe('400.00');
    expect(linea(r.ajustes[0], '2403')?.haber).toBe('400.00');
    expect(linea(r.ajustes[1], '2400')?.debe).toBe('210.00');
    expect(linea(r.ajustes[1], '1136')?.haber).toBe('150.00');
    expect(linea(r.ajustes[1], '7609')?.haber).toBe('60.00');
  });

  it('puesta en equivalencia con pérdidas y diferencia negativa', () => {
    const r = eliminacionInversionPatrimonio({
      ...base,
      metodo: 'puesta_equivalencia',
      participacionPct: 40,
      costeInversion: 300,
      patrimonioAdquisicion: 1000,
      patrimonioCierre: 1000,
      resultadoPeriodo: -250,
    });
    // Parte adquirida 400 > coste 300: diferencia negativa de 100.
    expect(r.diferenciaNegativa).toBe(100);
    expect(r.resultadoPuestaEquivalencia).toBe(-100);
    expect(r.valorPuestaEquivalencia).toBe(300);
    for (const a of r.ajustes) expect(cuadre(a)).toBe(0n);
    expect(linea(r.ajustes[1], '7609')?.debe).toBe('100.00');
    expect(linea(r.ajustes[1], '7740')?.haber).toBe('100.00');
  });

  it('cuadra y reparte socios externos al céntimo con participaciones raras', () => {
    for (const pct of [0.01, 33.33, 50, 66.67, 99.99]) {
      for (const pn of ['1000.01', '-333.33', '0.07', '123456.78']) {
        const pnCierre = '98765.43';
        const r = eliminacionInversionPatrimonio({
          ...base,
          participacionPct: pct,
          costeInversion: '777.77',
          patrimonioAdquisicion: pn,
          patrimonioCierre: pnCierre,
        });
        for (const a of r.ajustes) expect(cuadre(a)).toBe(0n);
        const ext =
          toCents(r.sociosExternosAdquisicion) +
          toCents(r.sociosExternosPosteriores);
        const esperado =
          (toCents(pnCierre) * BigInt(Math.round((100 - pct) * 100)) * 2n +
            10_000n) /
          20_000n;
        expect(ext).toBe(esperado);
        expect(
          toCents(r.participacionAdquirida) +
            toCents(r.sociosExternosAdquisicion),
        ).toBe(toCents(pn));
      }
    }
  });

  it('rechaza cuentas de inversión fuera del grupo 2 y participaciones fuera de rango', () => {
    expect(() =>
      eliminacionInversionPatrimonio({ ...base, cuentaInversion: '5720' }),
    ).toThrow(RangeError);
    expect(() =>
      eliminacionInversionPatrimonio({ ...base, participacionPct: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      eliminacionInversionPatrimonio({ ...base, costeInversion: -1 }),
    ).toThrow(RangeError);
  });
});

describe('consolidación completa con inversión–PN', () => {
  it('el balance consolidado cuadra y los socios externos coinciden con consolidarEstados', () => {
    const elim = eliminacionInversionPatrimonio({
      companyId: 'B',
      metodo: 'global',
      participacionPct: 80,
      costeInversion: 900,
      cuentaInversion: '2403',
      patrimonioAdquisicion: 1000,
      patrimonioCierre: 1200,
      resultadoPeriodo: 0,
      adquisicionEnPeriodo: false,
    });
    const r = consolidarEstados({
      sociedades: [
        {
          companyId: 'A',
          nombre: 'Matriz',
          metodo: 'global',
          participacionPct: 100,
          saldos: [
            { codigo: '2403', saldoDeudor: 900 },
            { codigo: '5720', saldoDeudor: 100 },
            { codigo: '1000', saldoDeudor: -1000 },
          ],
        },
        {
          companyId: 'B',
          nombre: 'Filial',
          metodo: 'global',
          participacionPct: 80,
          saldos: [
            { codigo: '2130', saldoDeudor: 1200 },
            { codigo: '1000', saldoDeudor: -1000 },
            { codigo: '1130', saldoDeudor: -200 },
          ],
        },
      ],
      ajustes: elim.ajustes,
    });
    expect(r.totales).toMatchObject({
      activo: 1400, // 100 tesorería + 1.200 maquinaria + 100 fondo de comercio
      patrimonio: 1400,
      descuadreBalance: 0,
    });
    const grupo2 = r.porGrupo.find((f) => f.clave === '2')!;
    expect(grupo2.consolidado).toBe(1300);
    expect(r.sociosExternos.patrimonio).toBe(
      elim.sociosExternosAdquisicion + elim.sociosExternosPosteriores,
    );
  });

  it('la puesta en equivalencia no integra saldos: solo entra por sus ajustes', () => {
    const r = consolidarEstados({
      sociedades: [
        {
          companyId: 'A',
          nombre: 'Matriz',
          metodo: 'global',
          participacionPct: 100,
          saldos: [
            { codigo: '2403', saldoDeudor: 400 },
            { codigo: '1000', saldoDeudor: -400 },
          ],
        },
        {
          companyId: 'C',
          nombre: 'Asociada',
          metodo: 'puesta_equivalencia',
          participacionPct: 30,
          saldos: [
            { codigo: '2130', saldoDeudor: 1500 },
            { codigo: '1000', saldoDeudor: -1500 },
          ],
        },
      ],
      ajustes: [],
    });
    expect(r.totales.activo).toBe(400);
    expect(r.porMasa[0].porSociedad).not.toHaveProperty('C');
    expect(r.sociosExternos.porSociedad).toHaveLength(0);
  });
});

describe('esquemas de Group Reporting', () => {
  it('alta de sociedad: NIF y moneda normalizados, grupo y admin opcionales', () => {
    const d = sociedadCreateSchema.parse({
      nombre: 'Dintel USA Inc',
      nif: ' us-123456 ',
      monedaFuncional: 'usd',
    });
    expect(d).toMatchObject({
      nif: 'US-123456',
      monedaFuncional: 'USD',
      inicializarPlan: true,
    });
    expect(
      sociedadCreateSchema.safeParse({
        nombre: 'X S.L.',
        nif: 'B1',
        monedaFuncional: 'EUR',
      }).success,
    ).toBe(false);
    expect(
      sociedadCreateSchema.safeParse({
        nombre: 'Filial SL',
        nif: 'B12345678',
        monedaFuncional: 'EURO',
      }).success,
    ).toBe(false);
  });

  it('tipo de cambio: cierre a una fecha y medio con periodo', () => {
    expect(
      tipoCambioCreateSchema.safeParse({
        moneda: 'USD',
        tipo: 'cierre',
        desde: '2026-12-31',
        tasa: 0.91234567,
      }).success,
    ).toBe(true);
    expect(
      tipoCambioCreateSchema.safeParse({
        moneda: 'USD',
        tipo: 'cierre',
        desde: '2026-01-01',
        hasta: '2026-12-31',
        tasa: 0.9,
      }).success,
    ).toBe(false);
    expect(
      tipoCambioCreateSchema.safeParse({
        moneda: 'USD',
        tipo: 'medio',
        desde: '2026-01-01',
        tasa: 0.9,
      }).success,
    ).toBe(false);
    expect(
      tipoCambioCreateSchema.safeParse({
        moneda: 'USD',
        tipo: 'cierre',
        desde: '2026-12-31',
        tasa: 0,
      }).success,
    ).toBe(false);
    expect(
      tipoCambioCreateSchema.safeParse({
        moneda: 'USD',
        tipo: 'cierre',
        desde: '2026-12-31',
        tasa: 0.123456789,
      }).success,
    ).toBe(false);
  });

  it('miembro: puesta en equivalencia e inversión con cuenta del grupo 2', () => {
    const base = {
      companyId: '11111111-1111-4111-8111-111111111111',
      participacionPct: 30,
      fechaAlta: '2026-01-01',
    };
    expect(
      miembroCreateSchema.parse({
        ...base,
        metodo: 'puesta_equivalencia',
        costeInversion: 400,
      }).metodo,
    ).toBe('puesta_equivalencia');
    expect(
      miembroCreateSchema.safeParse({
        ...base,
        costeInversion: 400,
        cuentaInversion: '5720',
      }).success,
    ).toBe(false);
    expect(
      miembroCreateSchema.safeParse({ ...base, costeInversion: -1 }).success,
    ).toBe(false);
  });
});

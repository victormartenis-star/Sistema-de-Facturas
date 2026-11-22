import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  amountsMatch,
  buildRectificationLines,
  computeCertification,
  computeInvoiceAmounts,
  computeIrr,
  computeNpv,
  computeRetention,
  computeVatBreakdown,
  daysBetween,
  payableAmount,
  planMilestones,
  planRectificationMilestones,
  repartirImporte,
  round2,
  sumarImportes,
  startOfMonth,
  startOfWeek,
  importeLiquidacionConSigno,
  motivoLiquidacionInvalida,
  resumenLiquidacion,
} from './calculo';

describe('round2', () => {
  it('elimina el ruido de la coma flotante', () => {
    // 100 + 21 en coma flotante da 121.00000000000001
    expect(round2(100 + 100 * 0.21)).toBe(121);
  });

  it('redondea al alza en el medio céntimo', () => {
    expect(round2(0.005)).toBe(0.01);
    expect(round2(2.675)).toBe(2.68);
  });

  it('no altera un importe que ya tiene dos decimales', () => {
    expect(round2(1234.56)).toBe(1234.56);
  });

  it('limitación conocida: no todo medio céntimo sube', () => {
    // 1.005 no es representable en binario: vale 1.00499999999999989, así que
    // redondea a 1.00 y no a 1.01. Es inherente a la coma flotante y solo se
    // evita calculando en céntimos enteros o con decimal.js. Se documenta
    // aquí en lugar de fingir que no ocurre; el desvío máximo es de un
    // céntimo por operación y el cuadre con albaranes ya lo tolera.
    expect(round2(1.005)).toBe(1);
  });
});

describe('amountsMatch', () => {
  it('acepta un céntimo de diferencia por redondeo', () => {
    expect(amountsMatch(1000, 1000.01)).toBe(true);
    expect(amountsMatch(1000, 999.99)).toBe(true);
  });

  it('rechaza dos céntimos', () => {
    expect(amountsMatch(1000, 1000.02)).toBe(false);
  });
});

describe('computeInvoiceAmounts', () => {
  it('suma bases y aplica el IVA de cada línea', () => {
    const amounts = computeInvoiceAmounts(
      [
        { baseAmount: 1000, vatPct: 21 },
        { baseAmount: 500, vatPct: 10 },
      ],
      false,
      0,
    );
    expect(amounts.baseAmount).toBe(1500);
    expect(amounts.vatAmount).toBe(260); // 210 + 50
    expect(amounts.totalAmount).toBe(1760);
  });

  it('con ISP la cuota de IVA es cero, no un tipo cero sobre la base', () => {
    const amounts = computeInvoiceAmounts(
      [{ baseAmount: 10_000, vatPct: 21 }],
      true,
      0,
    );
    expect(amounts.baseAmount).toBe(10_000);
    expect(amounts.vatAmount).toBe(0);
    expect(amounts.totalAmount).toBe(10_000);
  });

  it('calcula la retención sobre la base imponible, nunca sobre el total', () => {
    const amounts = computeInvoiceAmounts(
      [{ baseAmount: 10_000, vatPct: 21 }],
      false,
      5,
    );
    expect(amounts.totalAmount).toBe(12_100);
    // 5 % de 10.000 = 500. Sobre el total serían 605: ese es el error clásico.
    expect(amounts.retentionAmount).toBe(500);
    expect(amounts.retentionAmount).not.toBe(605);
  });

  it('retiene sobre la base aunque haya ISP', () => {
    const amounts = computeInvoiceAmounts(
      [{ baseAmount: 10_000, vatPct: 21 }],
      true,
      5,
    );
    expect(amounts.vatAmount).toBe(0);
    expect(amounts.retentionAmount).toBe(500);
  });

  it('una factura sin líneas queda a cero y no da NaN', () => {
    expect(computeInvoiceAmounts([], false, 5)).toEqual({
      baseAmount: 0,
      vatAmount: 0,
      totalAmount: 0,
      retentionAmount: 0,
    });
  });

  it('redondea el IVA de importes con decimales', () => {
    const amounts = computeInvoiceAmounts(
      [{ baseAmount: 33.33, vatPct: 21 }],
      false,
      0,
    );
    expect(amounts.vatAmount).toBe(7); // 6.9993
    expect(amounts.totalAmount).toBe(40.33);
  });
});

describe('payableAmount', () => {
  it('descuenta del total lo retenido en garantía', () => {
    expect(payableAmount(12_100, 500)).toBe(11_600);
  });
});

describe('planMilestones', () => {
  const base = {
    kind: 'venta' as const,
    issueDate: '2026-03-10',
    dueDate: null,
    totalAmount: 12_100,
    retentionAmount: 0,
    retentionReleaseDate: null,
    paymentTermsDays: 60,
  };

  it('una venta genera un cobro; una compra, un pago', () => {
    expect(planMilestones(base)[0].direction).toBe('cobro');
    expect(planMilestones({ ...base, kind: 'compra' })[0].direction).toBe(
      'pago',
    );
  });

  it('sin vencimiento pactado aplica el plazo de pago del contacto', () => {
    const [ordinario] = planMilestones(base);
    expect(ordinario.dueDate).toBe('2026-05-09'); // 10/03 + 60 días
    expect(ordinario.amount).toBe(12_100);
  });

  it('el vencimiento pactado manda sobre el plazo del contacto', () => {
    const [ordinario] = planMilestones({ ...base, dueDate: '2026-04-01' });
    expect(ordinario.dueDate).toBe('2026-04-01');
  });

  it('con retención genera dos vencimientos, no uno por el total', () => {
    const plan = planMilestones({
      ...base,
      retentionAmount: 500,
      retentionReleaseDate: '2027-03-10',
    });
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({
      kind: 'ordinario',
      amount: 11_600,
      dueDate: '2026-05-09',
    });
    expect(plan[1]).toMatchObject({
      kind: 'retencion',
      amount: 500,
      dueDate: '2027-03-10',
    });
    // Lo planificado suma exactamente el total de la factura
    expect(plan[0].amount + plan[1].amount).toBe(base.totalAmount);
  });

  it('sin fecha de liberación la retención vence a un año de la emisión', () => {
    const plan = planMilestones({ ...base, retentionAmount: 500 });
    expect(plan[1].dueDate).toBe('2027-03-10');
  });

  it('una factura íntegramente retenida no genera vencimiento ordinario', () => {
    const plan = planMilestones({
      ...base,
      totalAmount: 500,
      retentionAmount: 500,
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe('retencion');
  });

  it('una factura a cero no genera vencimientos', () => {
    expect(
      planMilestones({ ...base, totalAmount: 0, retentionAmount: 0 }),
    ).toHaveLength(0);
  });
});

describe('computeCertification', () => {
  it('la primera certificación cobra todo el acumulado', () => {
    const c = computeCertification(500_000, 20, 0, 5);
    expect(c.cumulativeAmount).toBe(100_000);
    expect(c.periodAmount).toBe(100_000);
    expect(c.retentionAmount).toBe(5_000);
  });

  it('a origen: el periodo es la diferencia contra lo ya certificado', () => {
    // Obra de 500.000 €, tres meses seguidos al 20 %, 35 % y 60 %
    const uno = computeCertification(500_000, 20, 0, 5);
    const dos = computeCertification(500_000, 35, uno.cumulativeAmount, 5);
    const tres = computeCertification(500_000, 60, dos.cumulativeAmount, 5);

    expect(dos.periodAmount).toBe(75_000); // 175.000 - 100.000
    expect(tres.periodAmount).toBe(125_000); // 300.000 - 175.000
    expect(tres.cumulativeAmount).toBe(300_000);
    // La suma de los periodos reconstruye el acumulado
    expect(uno.periodAmount + dos.periodAmount + tres.periodAmount).toBe(
      tres.cumulativeAmount,
    );
  });

  it('una medición a la baja produce un periodo negativo, no un error', () => {
    // Corregir a la baja una medición anterior es legítimo: se certifica menos
    const c = computeCertification(500_000, 30, 175_000, 5);
    expect(c.periodAmount).toBe(-25_000);
    expect(c.retentionAmount).toBe(-1_250);
  });

  it('al 100 % el acumulado es el importe de contrato', () => {
    expect(computeCertification(347_891.37, 100, 0, 0).cumulativeAmount).toBe(
      347_891.37,
    );
  });
});

describe('fechas', () => {
  it('addDays cruza fin de mes y año', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('addDays respeta el año bisiesto', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('addMonths avanza meses naturales', () => {
    expect(addMonths('2026-01-15', 2)).toBe('2026-03-15');
  });

  it('daysBetween es negativo si la fecha ya pasó', () => {
    expect(daysBetween('2026-03-10', '2026-03-20')).toBe(10);
    expect(daysBetween('2026-03-20', '2026-03-10')).toBe(-10);
    expect(daysBetween('2026-03-10', '2026-03-10')).toBe(0);
  });

  it('daysBetween no se descuadra con el cambio de hora', () => {
    // Último domingo de marzo: en hora local hay un día de 23 horas
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    // Último domingo de octubre: un día de 25 horas
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('startOfWeek devuelve el lunes', () => {
    expect(startOfWeek('2026-03-11')).toBe('2026-03-09'); // miércoles → lunes
    expect(startOfWeek('2026-03-09')).toBe('2026-03-09'); // lunes → él mismo
    expect(startOfWeek('2026-03-15')).toBe('2026-03-09'); // domingo → lunes previo
  });

  it('startOfMonth devuelve el día 1', () => {
    expect(startOfMonth('2026-03-31')).toBe('2026-03-01');
  });
});

describe('computeNpv', () => {
  it('sin flujos, VAN es 0', () => {
    expect(computeNpv(0.1, [])).toBe(0);
  });

  it('a tasa 0, el VAN es la suma simple de los flujos', () => {
    const flows = [
      { date: '2026-01-01', amount: -1000 },
      { date: '2026-06-01', amount: 300 },
      { date: '2027-01-01', amount: 800 },
    ];
    expect(computeNpv(0, flows)).toBe(100);
  });

  it('una aportación y un único retorno un año después: VAN=0 a la tasa exacta de retorno', () => {
    // -1000 hoy, +1100 dentro de un año → retorno exacto del 10%.
    const flows = [
      { date: '2026-01-01', amount: -1000 },
      { date: '2027-01-01', amount: 1100 },
    ];
    expect(computeNpv(0.1, flows)).toBeCloseTo(0, 2);
  });

  it('a una tasa superior a la de retorno, el VAN es negativo', () => {
    const flows = [
      { date: '2026-01-01', amount: -1000 },
      { date: '2027-01-01', amount: 1100 },
    ];
    expect(computeNpv(0.2, flows)).toBeLessThan(0);
  });
});

describe('computeIrr', () => {
  it('con menos de 2 flujos no se puede calcular', () => {
    expect(computeIrr([])).toBeNull();
    expect(computeIrr([{ date: '2026-01-01', amount: -1000 }])).toBeNull();
  });

  it('con todos los flujos del mismo signo no hay retorno que buscar', () => {
    expect(
      computeIrr([
        { date: '2026-01-01', amount: -1000 },
        { date: '2027-01-01', amount: -100 },
      ]),
    ).toBeNull();
  });

  it('una aportación y un retorno del 10% un año después → TIR ≈ 10%', () => {
    const flows = [
      { date: '2026-01-01', amount: -1000 },
      { date: '2027-01-01', amount: 1100 },
    ];
    expect(computeIrr(flows)).toBeCloseTo(0.1, 3);
  });

  it('una aportación en dos tramos y un reparto final', () => {
    // -600 al inicio, -400 a mitad de año, +1200 al año: retorno claramente positivo.
    const flows = [
      { date: '2026-01-01', amount: -600 },
      { date: '2026-07-01', amount: -400 },
      { date: '2027-01-01', amount: 1200 },
    ];
    const irr = computeIrr(flows);
    expect(irr).not.toBeNull();
    expect(irr as number).toBeGreaterThan(0.1);
    // El VAN a la TIR encontrada debe rondar 0 (es su definición).
    expect(Math.abs(computeNpv(irr as number, flows))).toBeLessThan(1);
  });

  it('una pérdida (retorno menor que lo aportado) da TIR negativa', () => {
    const flows = [
      { date: '2026-01-01', amount: -1000 },
      { date: '2027-01-01', amount: 800 },
    ];
    const irr = computeIrr(flows);
    expect(irr).not.toBeNull();
    expect(irr as number).toBeLessThan(0);
  });
});

describe('retención sobre céntimos exactos', () => {
  it('caso de referencia: 5 % sobre 20,10 € son 1,01 € (con round2 daba 1,00)', () => {
    expect(computeRetention(20.1, 5)).toBe(1.01);
    expect(
      computeInvoiceAmounts([{ baseAmount: 20.1, vatPct: 21 }], false, 5),
    ).toMatchObject({ retentionAmount: 1.01 });
  });

  it('otros medios céntimos que fallaban con coma flotante', () => {
    expect(computeRetention(2.9, 5)).toBe(0.15);
    expect(computeRetention(25.1, 5)).toBe(1.26);
  });

  it('acepta el numeric de Postgres como string', () => {
    expect(computeRetention('20.10', '5.00')).toBe(1.01);
  });

  it('computeCertification(402, 5 %, 0, 5 %): acumulado 20,10 y retención 1,01', () => {
    const c = computeCertification(402, 5, 0, 5);
    expect(c.cumulativeAmount).toBe(20.1);
    expect(c.retentionAmount).toBe(1.01);
  });

  it('es simétrica: la rectificativa con signo cambiado netea a cero', () => {
    const lines = [{ baseAmount: 20.1, vatPct: 21 }];
    const original = computeInvoiceAmounts(lines, false, 5);
    const rect = computeInvoiceAmounts(
      lines.map((l) => ({ ...l, baseAmount: -l.baseAmount })),
      false,
      5,
    );
    expect(rect.retentionAmount).toBe(-1.01);
    expect(original.baseAmount + rect.baseAmount).toBe(0);
    expect(original.vatAmount + rect.vatAmount).toBe(0);
    expect(original.totalAmount + rect.totalAmount).toBe(0);
    expect(original.retentionAmount + rect.retentionAmount).toBe(0);
  });

  it('payableAmount resta en céntimos exactos', () => {
    expect(payableAmount(24.32, 1.01)).toBe(23.31);
    expect(payableAmount(0.3, 0.1)).toBe(0.2);
  });
});

describe('computeVatBreakdown', () => {
  it('un grupo por tipo de IVA y la cuota total es la suma de grupos', () => {
    const v = computeVatBreakdown(
      [
        { baseAmount: 100, vatPct: 21 },
        { baseAmount: 50.5, vatPct: 10 },
        { baseAmount: 20, vatPct: 21 },
      ],
      false,
    );
    expect(v.groups).toEqual([
      { vatPct: 10, baseAmount: 50.5, vatAmount: 5.05 },
      { vatPct: 21, baseAmount: 120, vatAmount: 25.2 },
    ]);
    expect(v.baseAmount).toBe(170.5);
    expect(v.vatAmount).toBe(30.25);
    expect(v.totalAmount).toBe(200.75);
    expect(v.isp).toBe(false);
    expect(v.selfAssessedVat).toBe(0);
  });

  it('la cuota se redondea por grupo, no línea a línea', () => {
    // 3 líneas de 0,50 al 21 %: por línea 0,105 → 0,11 (×3 = 0,33);
    // por grupo 1,50 × 21 % = 0,315 → 0,32.
    const v = computeVatBreakdown(
      Array.from({ length: 3 }, () => ({ baseAmount: 0.5, vatPct: 21 })),
      false,
    );
    expect(v.vatAmount).toBe(0.32);
  });

  it('con ISP la cuota es 0, el total es la base y se informa la autoliquidada', () => {
    const v = computeVatBreakdown([{ baseAmount: 1000, vatPct: 21 }], true);
    expect(v.vatAmount).toBe(0);
    expect(v.totalAmount).toBe(1000);
    expect(v.selfAssessedVat).toBe(210);
    expect(v.isp).toBe(true);
  });
});

describe('buildRectificationLines', () => {
  it('cambia el signo de la base y conserva el resto, sin mutar el origen', () => {
    const origen = [
      { description: 'A', baseAmount: 100.5, vatPct: 21 },
      { description: 'B', baseAmount: 0, vatPct: 10 },
    ];
    const r = buildRectificationLines(origen);
    expect(r.map((l) => l.baseAmount)).toEqual([-100.5, 0]);
    expect(Object.is(r[1].baseAmount, -0)).toBe(false);
    expect(r[0].description).toBe('A');
    expect(origen[0].baseAmount).toBe(100.5);
  });

  it('original + rectificativa total netean a cero en base, IVA, total y retención', () => {
    const lines = [{ baseAmount: 20.1, vatPct: 21 }];
    const a = computeInvoiceAmounts(lines, false, 5);
    const b = computeInvoiceAmounts(buildRectificationLines(lines), false, 5);
    expect(b.retentionAmount).toBe(-1.01);
    expect(a.baseAmount + b.baseAmount).toBe(0);
    expect(a.vatAmount + b.vatAmount).toBe(0);
    expect(a.totalAmount + b.totalAmount).toBe(0);
    expect(a.retentionAmount + b.retentionAmount).toBe(0);
  });
});

describe('planRectificationMilestones', () => {
  const base = {
    kind: 'venta' as const,
    issueDate: '2026-10-01',
    dueDate: null,
    retentionReleaseDate: null,
    paymentTermsDays: 30,
  };

  it('total sin pagos: no genera vencimientos', () => {
    const plan = planRectificationMilestones({
      ...base,
      totalAmount: -1000,
      retentionAmount: -50,
      rectificationKind: 'total',
      originalPaid: { ordinario: 0, retencion: 0 },
    });
    expect(plan).toEqual([]);
  });

  it('total con ordinario ya cobrado: un pago por ese importe', () => {
    const plan = planRectificationMilestones({
      ...base,
      totalAmount: -1000,
      retentionAmount: -50,
      rectificationKind: 'total',
      originalPaid: { ordinario: 950, retencion: 0 },
    });
    expect(plan).toEqual([
      {
        direction: 'pago',
        kind: 'ordinario',
        dueDate: '2026-10-31',
        amount: 950,
      },
    ]);
  });

  it('total de una compra pagada: la devolución es un cobro', () => {
    const plan = planRectificationMilestones({
      ...base,
      kind: 'compra',
      totalAmount: -500,
      retentionAmount: 0,
      rectificationKind: 'total',
      originalPaid: { ordinario: 500, retencion: 0 },
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].direction).toBe('cobro');
    expect(plan[0].amount).toBe(500);
  });

  it('diferencias negativa con retención: pago ordinario y pago de retención, importes positivos', () => {
    const plan = planRectificationMilestones({
      ...base,
      totalAmount: -200,
      retentionAmount: -10,
      rectificationKind: 'diferencias',
      originalPaid: { ordinario: 0, retencion: 0 },
    });
    expect(plan).toEqual([
      {
        direction: 'pago',
        kind: 'ordinario',
        dueDate: '2026-10-31',
        amount: 190,
      },
      {
        direction: 'pago',
        kind: 'retencion',
        dueDate: '2027-10-01',
        amount: 10,
      },
    ]);
  });

  it('diferencias positiva: vencimientos normales (cobro en una venta)', () => {
    const plan = planRectificationMilestones({
      ...base,
      totalAmount: 100,
      retentionAmount: 5,
      rectificationKind: 'diferencias',
      originalPaid: { ordinario: 0, retencion: 0 },
    });
    expect(plan.map((m) => [m.direction, m.kind, m.amount])).toEqual([
      ['cobro', 'ordinario', 95],
      ['cobro', 'retencion', 5],
    ]);
  });
});

describe('repartirImporte', () => {
  it('la suma del reparto es exactamente el total', () => {
    expect(repartirImporte(10.02, [100.1, 100.2])).toEqual([5.01, 5.01]);
    expect(repartirImporte(10.01, [100.07, 100.07])).toEqual([5.01, 5.0]);
  });

  it('3 obras con céntimos sobrantes: resto mayor, desempate por índice bajo', () => {
    expect(repartirImporte(100, [1, 1, 1])).toEqual([33.34, 33.33, 33.33]);
    expect(repartirImporte(0.05, [1, 1, 1])).toEqual([0.02, 0.02, 0.01]);
    expect(repartirImporte(0.1, [1, 1, 4])).toEqual([0.02, 0.02, 0.06]);
  });

  it('una sola obra recibe el importe intacto', () => {
    expect(repartirImporte(123.45, [987.65])).toEqual([123.45]);
  });

  it('signo negativo simétrico: el reparto de −T es el opuesto del de T', () => {
    expect(repartirImporte(-100, [1, 1, 1])).toEqual([-33.34, -33.33, -33.33]);
    expect(repartirImporte(-100, [-1, -1, -1])).toEqual([
      -33.34, -33.33, -33.33,
    ]);
    expect(repartirImporte(100, [-1, -1, -1])).toEqual([33.34, 33.33, 33.33]);
  });

  it('propiedad: suma exacta con totales y pesos variados', () => {
    const casos = [
      [1, 2, 3],
      [0.07, 0.07, 0.07],
      [5, 0, 5],
      [9, -3, 4],
    ];
    for (let t = -50; t <= 50; t += 7) {
      for (const pesos of casos) {
        const parts = repartirImporte(t / 7, pesos);
        const suma = parts.reduce((s, x) => s + Math.round(x * 100), 0);
        expect(suma).toBe(Math.round((t / 7) * 100));
      }
    }
  });

  it('límites', () => {
    expect(repartirImporte(0, [1, 2])).toEqual([0, 0]);
    expect(repartirImporte(5, [0, 0])).toEqual([5, 0]);
    expect(repartirImporte(0, [])).toEqual([]);
    expect(() => repartirImporte(1, [])).toThrow(RangeError);
  });
});

describe('sumarImportes', () => {
  it('suma importes de céntimos sin error de coma flotante', () => {
    // Con suma directa en coma flotante queda 1335.2499999999998.
    expect(
      sumarImportes([0.1, 0.2, 0.3, 1234.56, 0.07, 99.99, 0.01, 0.01, 0.01]),
    ).toBe(1335.25);
  });

  it('vacío es 0', () => {
    expect(sumarImportes([])).toBe(0);
  });

  it('admite importes negativos (rectificativas) sin deriva', () => {
    expect(sumarImportes([10.1, -0.1, 0.2])).toBe(10.2);
  });
});

describe('liquidaciones parciales', () => {
  it('resumen exacto en céntimos y estado derivado', () => {
    expect(resumenLiquidacion('1210.00', '0')).toEqual({
      importe: 1210,
      liquidado: 0,
      pendiente: 1210,
      estado: 'pendiente',
    });
    expect(resumenLiquidacion('0.30', 0.1).pendiente).toBe(0.2);
    expect(resumenLiquidacion('1210.00', '400.10').estado).toBe('parcial');
    expect(resumenLiquidacion('1210.00', '1210.00').estado).toBe('liquidado');
    expect(resumenLiquidacion('-121.00', '-21.00')).toMatchObject({
      pendiente: -100,
      estado: 'parcial',
    });
  });

  const base = {
    importe: '100.00',
    liquidado: '60.00',
    fecha: '2026-11-20',
    hoy: '2026-11-22',
  };

  it('acepta liquidar exactamente el saldo pendiente', () => {
    expect(motivoLiquidacionInvalida({ ...base, cantidad: 40 })).toBeNull();
  });

  it('rechaza superar el pendiente por un céntimo', () => {
    expect(motivoLiquidacionInvalida({ ...base, cantidad: 40.01 })?.code).toBe(
      'SETTLEMENT_EXCEEDS_OUTSTANDING',
    );
  });

  it('rechaza importes no positivos, fechas futuras y vencimientos ya liquidados', () => {
    expect(motivoLiquidacionInvalida({ ...base, cantidad: 0 })?.code).toBe(
      'SETTLEMENT_AMOUNT_INVALID',
    );
    expect(
      motivoLiquidacionInvalida({ ...base, cantidad: 1, fecha: '2026-11-23' })
        ?.code,
    ).toBe('SETTLEMENT_DATE_IN_FUTURE');
    expect(
      motivoLiquidacionInvalida({ ...base, liquidado: '100.00', cantidad: 1 })
        ?.code,
    ).toBe('DUE_ALREADY_SETTLED');
  });

  it('en rectificativas el pendiente se mide en magnitud y el signo lo pone el vencimiento', () => {
    expect(
      motivoLiquidacionInvalida({
        ...base,
        importe: '-100.00',
        liquidado: '-60.00',
        cantidad: 40,
      }),
    ).toBeNull();
    expect(importeLiquidacionConSigno('-100.00', 40)).toBe(-4000n);
    expect(importeLiquidacionConSigno('100.00', 40)).toBe(4000n);
  });
});

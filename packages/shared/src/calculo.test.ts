import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  amountsMatch,
  computeCertification,
  computeInvoiceAmounts,
  daysBetween,
  payableAmount,
  planMilestones,
  round2,
  startOfMonth,
  startOfWeek,
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

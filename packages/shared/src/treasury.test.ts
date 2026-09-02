import { describe, expect, it } from 'vitest';
import {
  TREASURY_HORIZON_WEEKS,
  buildThirteenWeek,
  weekLabel,
  type CashItem,
} from './treasury';

/** Un miércoles, para comprobar que el horizonte arranca en su lunes. */
const HOY = '2026-09-02';
const LUNES = '2026-08-31';

const cobro = (
  dueDate: string,
  amount: number,
  confirmed = true,
): CashItem => ({
  dueDate,
  direction: 'cobro',
  amount,
  confirmed,
  concept: 'Certificación',
});

const pago = (dueDate: string, amount: number, confirmed = true): CashItem => ({
  dueDate,
  direction: 'pago',
  amount,
  confirmed,
  concept: 'Factura de subcontrata',
});

describe('horizonte', () => {
  it('son trece semanas, y empiezan en el lunes de la semana en curso', () => {
    const r = buildThirteenWeek(HOY, 0, []);
    expect(r.weeks).toHaveLength(TREASURY_HORIZON_WEEKS);
    expect(r.from).toBe(LUNES);
    expect(r.weeks[0].weekStart).toBe(LUNES);
    // Trece semanas justas: del lunes al domingo de la decimotercera.
    expect(r.to).toBe('2026-11-29');
  });

  it('las semanas van seguidas, sin huecos ni repetidas', () => {
    const r = buildThirteenWeek(HOY, 0, []);
    const dias = r.weeks.map((w) => Date.parse(w.weekStart));
    for (let i = 1; i < dias.length; i++) {
      expect(dias[i] - dias[i - 1]).toBe(7 * 24 * 3600 * 1000);
    }
  });

  it('las semanas vacías salen igual, no se saltan', () => {
    const r = buildThirteenWeek(HOY, 0, [cobro('2026-11-25', 1_000)]);
    expect(r.weeks.filter((w) => w.cobros === 0)).toHaveLength(12);
  });

  it('la etiqueta es corta y con el día del lunes', () => {
    expect(weekLabel('2026-09-07')).toBe('Sem. 07/09');
  });
});

describe('saldo de partida', () => {
  it('sin saldo de partida no se inventa un saldo', () => {
    // Una previsión que empieza en cero no dice si hay tensión de caja: dice
    // si las trece semanas son netamente positivas, que es otra pregunta.
    const r = buildThirteenWeek(HOY, null, [pago('2026-09-10', 80_000)]);
    expect(r.openingBalance).toBeNull();
    expect(r.weeks.every((w) => w.saldo === null)).toBe(true);
    expect(r.weeks.every((w) => w.tension === false)).toBe(true);
    expect(r.closingBalance).toBeNull();
    expect(r.minBalance).toBeNull();
    expect(r.firstTensionWeek).toBeNull();
    expect(r.warnings.join(' ')).toContain('saldo de caja de partida');
  });

  it('los importes se siguen sumando aunque no haya saldo', () => {
    const r = buildThirteenWeek(HOY, null, [
      cobro('2026-09-10', 100_000),
      pago('2026-09-10', 80_000),
    ]);
    expect(r.totalCobros).toBe(100_000);
    expect(r.totalPagos).toBe(80_000);
    expect(r.neto).toBe(20_000);
  });

  it('la misma semana mala es tensión o no según el saldo de partida', () => {
    const movimientos = [pago('2026-09-10', 50_000)];
    const holgada = buildThirteenWeek(HOY, 400_000, movimientos);
    const justa = buildThirteenWeek(HOY, 10_000, movimientos);
    expect(holgada.firstTensionWeek).toBeNull();
    expect(justa.firstTensionWeek).toBe('2026-09-07');
    expect(justa.minBalance).toBe(-40_000);
  });
});

describe('saldo acumulado', () => {
  it('arrastra el saldo semana a semana', () => {
    const r = buildThirteenWeek(HOY, 100_000, [
      cobro('2026-09-03', 30_000),
      pago('2026-09-15', 50_000),
    ]);
    expect(r.weeks[0].saldo).toBe(130_000);
    expect(r.weeks[1].saldo).toBe(130_000);
    expect(r.weeks[2].saldo).toBe(80_000);
    expect(r.closingBalance).toBe(80_000);
  });

  it('el punto más bajo casi nunca es el último, y por eso se devuelve', () => {
    // Semana 2 en −20.000 y luego un cobro grande que lo tapa. Mirando solo
    // el saldo final, la obra parece desahogada.
    const r = buildThirteenWeek(HOY, 30_000, [
      pago('2026-09-08', 50_000),
      cobro('2026-10-06', 200_000),
    ]);
    expect(r.closingBalance).toBe(180_000);
    expect(r.minBalance).toBe(-20_000);
    expect(r.minBalanceWeek).toBe('2026-09-07');
    expect(r.firstTensionWeek).toBe('2026-09-07');
  });

  it('avisa de la primera semana en negativo como fecha límite', () => {
    const r = buildThirteenWeek(HOY, 10_000, [pago('2026-09-22', 60_000)]);
    expect(r.warnings.join(' ')).toContain('2026-09-21');
    expect(r.warnings.join(' ')).toContain('fecha límite');
  });
});

describe('confirmado y previsto', () => {
  it('separa lo que tiene factura de lo que todavía no', () => {
    const r = buildThirteenWeek(HOY, 0, [
      cobro('2026-09-10', 100_000, true),
      cobro('2026-09-10', 40_000, false),
      pago('2026-09-10', 70_000, true),
      pago('2026-09-10', 25_000, false),
    ]);
    const w = r.weeks[1];
    expect(w.cobrosConfirmados).toBe(100_000);
    expect(w.cobrosPrevistos).toBe(40_000);
    expect(w.pagosConfirmados).toBe(70_000);
    expect(w.pagosPrevistos).toBe(25_000);
    expect(w.cobros).toBe(140_000);
    expect(w.pagos).toBe(95_000);
    expect(w.neto).toBe(45_000);
  });

  it('avisa cuando el cuadro se apoya demasiado en lo no confirmado', () => {
    const r = buildThirteenWeek(HOY, 100_000, [
      cobro('2026-09-10', 20_000, true),
      pago('2026-09-10', 80_000, false),
    ]);
    expect(r.warnings.join(' ')).toContain('vencimiento en firme');
  });

  it('con casi todo en firme no avisa de eso', () => {
    const r = buildThirteenWeek(HOY, 100_000, [
      cobro('2026-09-10', 90_000, true),
      pago('2026-09-10', 10_000, false),
    ]);
    expect(r.warnings.join(' ')).not.toContain('vencimiento en firme');
  });
});

describe('vencido y fuera de horizonte', () => {
  it('lo ya vencido antes del horizonte se arrastra a la primera semana', () => {
    // No desaparece por ser antiguo: sigue sin cobrarse y hay que resolverlo,
    // y la primera semana es donde se mira.
    const r = buildThirteenWeek(HOY, 0, [cobro('2026-06-15', 45_000)]);
    expect(r.weeks[0].cobros).toBe(45_000);
    expect(r.totalCobros).toBe(45_000);
  });

  it('lo que cae más allá de trece semanas queda fuera', () => {
    const r = buildThirteenWeek(HOY, 0, [pago('2027-03-01', 500_000)]);
    expect(r.totalPagos).toBe(0);
  });

  it('un horizonte vacío lo dice en lugar de aparentar calma', () => {
    const r = buildThirteenWeek(HOY, 250_000, []);
    expect(r.warnings.join(' ')).toContain('horizonte está vacío');
  });
});

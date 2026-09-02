import { describe, expect, it } from 'vitest';
import {
  buildDeviationRows,
  deviationWarnings,
  type PhaseCostInput,
} from './phases';

const partida = (p: Partial<PhaseCostInput> = {}): PhaseCostInput => ({
  phaseId: 'p1',
  code: '03',
  name: 'Albañilería y cerramientos',
  budget: 320_000,
  invoiced: 0,
  accrued: 0,
  committed: 0,
  ...p,
});

describe('buildDeviationRows', () => {
  it('el coste probable suma facturado, recibido y comprometido', () => {
    const [r] = buildDeviationRows([
      partida({ invoiced: 251_500, accrued: 14_000, committed: 164_500 }),
    ]);
    expect(r.probableCost).toBe(430_000);
  });

  it('el desvío se mide contra el coste probable, no contra lo gastado', () => {
    // El caso real que lo destapó: capítulo 03 de OBR-052. Gastado 251.500 €
    // de 320.000 € presupuestados parece un ahorro de 68.500 €, pero hay
    // 430.000 € en pedidos: la partida ya se ha pasado en 110.000 €.
    const [r] = buildDeviationRows([
      partida({ invoiced: 251_500, accrued: 14_000, committed: 164_500 }),
    ]);
    expect(r.deviation).toBe(110_000);
    expect(r.deviationPct).toBe(34.38);
    expect(r.light).toBe('rojo');
  });

  it('una partida dentro de objetivo sale en verde', () => {
    const [r] = buildDeviationRows([
      partida({ budget: 150_000, invoiced: 79_000, committed: 66_000 }),
    ]);
    expect(r.probableCost).toBe(145_000);
    expect(r.deviation).toBe(-5_000);
    expect(r.light).toBe('verde');
  });

  it('pasarse entre el 2 y el 5 % es para vigilar', () => {
    const [r] = buildDeviationRows([
      partida({ budget: 100_000, invoiced: 60_000, committed: 44_000 }),
    ]);
    expect(r.deviationPct).toBe(4);
    expect(r.light).toBe('ambar');
  });

  it('una partida sin un solo pedido no está ahorrando, está sin empezar', () => {
    // Su "ahorro" es el presupuesto entero. En verde parecería la partida
    // mejor llevada de la obra.
    const [r] = buildDeviationRows([partida({ budget: 180_000 })]);
    expect(r.started).toBe(false);
    expect(r.light).toBe('sin_datos');
    expect(r.deviationPct).toBeNull();
    // El importe sí se devuelve: es lo que queda por comprometer.
    expect(r.deviation).toBe(-180_000);
  });

  it('el coste imputado a una partida sin presupuesto no inventa un %', () => {
    const [r] = buildDeviationRows([partida({ budget: 0, invoiced: 12_000 })]);
    expect(r.started).toBe(true);
    expect(r.deviationPct).toBeNull();
    expect(r.deviation).toBe(12_000);
  });

  it('no pierde ninguna partida', () => {
    const rows = buildDeviationRows([
      partida({ phaseId: 'a', code: '01' }),
      partida({ phaseId: 'b', code: '02' }),
      partida({ phaseId: null, code: '—', budget: 0, invoiced: 500 }),
    ]);
    expect(rows.map((r) => r.code)).toEqual(['01', '02', '—']);
  });
});

describe('deviationWarnings', () => {
  it('avisa de la partida que ya se ha pasado', () => {
    const rows = buildDeviationRows([
      partida({ invoiced: 251_500, accrued: 14_000, committed: 164_500 }),
    ]);
    const [aviso] = deviationWarnings(rows);
    expect(aviso).toContain('03 Albañilería y cerramientos');
    expect(aviso).toContain('Lo comprometido no se deshace');
  });

  it('avisa del coste imputado a partidas sin presupuesto', () => {
    const rows = buildDeviationRows([
      partida({ code: '—', budget: 0, invoiced: 9_000 }),
    ]);
    expect(deviationWarnings(rows).join(' ')).toContain('sin presupuesto');
  });

  it('avisa de las partidas sin contratar y no las da por buenas', () => {
    const rows = buildDeviationRows([
      partida({ code: '06', budget: 180_000 }),
      partida({ code: '07', budget: 80_000 }),
    ]);
    const texto = deviationWarnings(rows).join(' ');
    expect(texto).toContain('2 partida(s) sin un solo pedido');
    expect(texto).toContain('No están ahorrando');
  });

  it('una obra con todo en objetivo no genera avisos', () => {
    const rows = buildDeviationRows([
      partida({ budget: 150_000, invoiced: 79_000, committed: 66_000 }),
    ]);
    expect(deviationWarnings(rows)).toEqual([]);
  });
});

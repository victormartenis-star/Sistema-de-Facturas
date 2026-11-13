import { readFileSync } from 'fs';
import { join } from 'path';
import { parseBc3 } from '../../src/budgets/bc3-parser';

// Fixtures SIMULADOS (mock de estructura estándar, no validados contra Presto).
const fixture = (n: string) =>
  readFileSync(join(__dirname, '..', 'fixtures', 'bc3', n), 'utf8');

describe('parseBc3 SIMULADO (descomposición de precios unitarios)', () => {
  it('capítulo con dos partidas simples: sigue sumando solo las hojas', () => {
    const { items } = parseBc3(fixture('SIMULADO-capitulo-dos-partidas.bc3'));
    expect(items.map((i) => i.code)).toEqual(['CAP01#', 'P01', 'P02']);
    expect(items.reduce((s, i) => s + i.totalAmount, 0)).toBe(300);
  });

  it('partida con tres costes directos y rendimiento 1,05', () => {
    const { items } = parseBc3(fixture('SIMULADO-partida-descompuesta.bc3'));
    const p = items.find((i) => i.code === 'P01')!;
    // 0,5×1,05×20 + 0,2×1,05×80 + 0,1×1,05×10 = 10,50 + 16,80 + 1,05
    expect(p.unitPrice).toBe(28.35);
    expect(p.totalAmount).toBe(283.5);
    // los costes directos no son partidas del presupuesto
    expect(items.map((i) => i.code)).toEqual(['CAP01#', 'P01']);
    expect(p.components!.map((c) => [c.code, c.conceptType])).toEqual([
      ['MO01', 'mano_obra'],
      ['MAT01', 'material'],
      ['MAQ01', 'maquinaria'],
    ]);
    expect(p.components!.map((c) => c.amount)).toEqual([10.5, 16.8, 1.05]);
  });

  it('subpartida anidada se resuelve recursivamente', () => {
    const { items } = parseBc3(fixture('SIMULADO-subpartida-anidada.bc3'));
    const p = items.find((i) => i.code === 'PA')!;
    // SUB01 = 2×20 + 1×80 = 120 ; PA = 0,25×120 + 1×20 = 50
    expect(p.unitPrice).toBe(50);
    expect(p.totalAmount).toBe(200);
    expect(items.some((i) => i.code === 'SUB01')).toBe(false);
  });

  it('cuatro decimales sin deriva de coma flotante', () => {
    const bc3 = [
      '~C|CAP#||Cap|0|',
      '~C|P|ud|Partida|0|',
      '~C|X|h|Coste|0.1||1|',
      '~C|Y|h|Indirecto|0.2||4|',
      '~D|ROOT##|CAP#|1|',
      '~C|ROOT##||Raiz|0|',
      '~D|CAP#|P|3|',
      '~D|P|X|1|1|',
      '~D|P|Y|1|1|',
    ].join('\n');
    const p = parseBc3(bc3).items.find((i) => i.code === 'P')!;
    expect(p.unitPrice).toBe(0.3);
    expect(p.totalAmount).toBe(0.9);
    expect(p.components!.map((c) => c.conceptType)).toEqual([
      'mano_obra',
      'indirecto',
    ]);
  });

  it('un ciclo en la descomposición no cuelga el parser y avisa', () => {
    const bc3 = [
      '~C|ROOT##||Raiz|0|',
      '~C|CAP#||Cap|0|',
      '~C|A|ud|A|0|',
      '~C|B|ud|B|0|',
      '~D|ROOT##|CAP#|1|',
      '~D|CAP#|A|1|',
      '~D|A|B|1|1|',
      '~D|B|A|1|1|',
    ].join('\n');
    const r = parseBc3(bc3);
    expect(r.warnings.join(' ')).toMatch(/ciclo/i);
  });
});

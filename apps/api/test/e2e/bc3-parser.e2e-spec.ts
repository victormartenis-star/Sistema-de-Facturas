import { parseBc3 } from '../../src/budgets/bc3-parser';

/**
 * Un BC3 estándar trae el precio agregado del capítulo además de sus
 * partidas. Sumar todos los nodos inflaba el presupuesto (capítulo + hojas):
 * el importe del presupuesto es la suma de las hojas.
 */
const BC3 = [
  '~V|FIEBDC-3/2016|Prueba|',
  '~C|OBR##||Obra de prueba|300|',
  '~C|CAP01#||Capitulo 1|300|',
  '~C|P1|m2|Partida uno|100|',
  '~C|P2|m3|Partida dos|50|',
  '~D|OBR##|CAP01#|1|',
  '~D|CAP01#|P1|1|',
  '~D|CAP01#|P2|4|',
].join('\n');

describe('parseBc3 (importes)', () => {
  it('el total importado es la suma de las partidas, sin duplicar el capítulo', () => {
    const { items } = parseBc3(BC3);
    const total = items.reduce((s, i) => s + i.totalAmount, 0);
    expect(total).toBe(300);
  });

  it('el capítulo no aporta importe propio y las partidas conservan el suyo', () => {
    const { items } = parseBc3(BC3);
    const por = new Map(items.map((i) => [i.code, i]));
    expect(por.get('CAP01#')!.totalAmount).toBe(0);
    expect(por.get('P1')!.totalAmount).toBe(100);
    expect(por.get('P2')!.totalAmount).toBe(200);
  });
});

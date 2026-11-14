import { describe, expect, it } from 'vitest';
import {
  TransicionInvalidaError,
  motivoTransicionInvalida,
  puedeTransitar,
  transicion,
  type Transiciones,
} from './maquina-estados';
import { BUDGET_STATUSES, BUDGET_TRANSITIONS } from './budgets';
import { CERT_STATUSES, CERT_TRANSITIONS } from './certifications';
import {
  DELIVERY_NOTE_STATUSES,
  DELIVERY_NOTE_TRANSITIONS,
} from './delivery-notes';
import { INVOICE_STATUSES, INVOICE_TRANSITIONS } from './invoices';
import {
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_TRANSITIONS,
  deriveOrderStatus,
} from './purchase-orders';
import { MILESTONE_STATUSES, MILESTONE_TRANSITIONS } from './treasury';

type S = 'a' | 'b' | 'c';
const T: Transiciones<S> = { a: ['b'], b: ['c'], c: [] };
const ETIQUETAS: Record<S, string> = { a: 'A', b: 'B', c: 'C' };

describe('puedeTransitar', () => {
  it('solo permite las transiciones declaradas', () => {
    expect(puedeTransitar(T, 'a', 'b')).toBe(true);
    expect(puedeTransitar(T, 'a', 'c')).toBe(false);
    expect(puedeTransitar(T, 'c', 'a')).toBe(false);
  });

  it('mantenerse en el mismo estado no es una transición', () => {
    expect(puedeTransitar(T, 'a', 'a')).toBe(false);
  });
});

describe('motivoTransicionInvalida', () => {
  it('devuelve null si es válida', () => {
    expect(
      motivoTransicionInvalida(T, 'a', 'b', ETIQUETAS, 'el doc'),
    ).toBeNull();
  });

  it('devuelve un mensaje listo para el 409 si no lo es', () => {
    const m = motivoTransicionInvalida(T, 'b', 'a', ETIQUETAS, 'el doc');
    expect(m).toContain('el doc');
    expect(m).toContain('B');
    expect(m).toContain('A');
  });

  it('distingue el estado terminal', () => {
    expect(
      motivoTransicionInvalida(T, 'c', 'b', ETIQUETAS, 'el doc'),
    ).toContain('terminal');
  });
});

const MATRICES = [
  ['invoice', INVOICE_STATUSES, INVOICE_TRANSITIONS],
  ['budget', BUDGET_STATUSES, BUDGET_TRANSITIONS],
  ['certification', CERT_STATUSES, CERT_TRANSITIONS],
  ['delivery_note', DELIVERY_NOTE_STATUSES, DELIVERY_NOTE_TRANSITIONS],
  ['purchase_order', PURCHASE_ORDER_STATUSES, PURCHASE_ORDER_TRANSITIONS],
  ['milestone', MILESTONE_STATUSES, MILESTONE_TRANSITIONS],
] as const;

const transicionSuelta = transicion as (
  entidad: string,
  de: string,
  a: string,
) => string;

describe('transicion: matriz por entidad', () => {
  for (const [entidad, estados, tabla] of MATRICES) {
    describe(entidad, () => {
      for (const de of estados) {
        for (const a of estados) {
          const legal = (tabla as Transiciones<string>)[de].includes(a);
          it(`${de} -> ${a}: ${legal ? 'legal' : 'ilegal'}`, () => {
            if (legal) {
              expect(transicionSuelta(entidad, de, a)).toBe(a);
            } else {
              expect(() => transicionSuelta(entidad, de, a)).toThrow(
                TransicionInvalidaError,
              );
            }
          });
        }
      }
    });
  }

  it('el error lleva código, entidad, de y a', () => {
    try {
      transicion('purchase_order', 'cerrado', 'anulado');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TransicionInvalidaError);
      const err = e as TransicionInvalidaError;
      expect(err.codigo).toBe('TRANSICION_INVALIDA');
      expect(err.entidad).toBe('purchase_order');
      expect(err.de).toBe('cerrado');
      expect(err.a).toBe('anulado');
    }
  });

  it('los estados terminales no admiten ninguna transición', () => {
    for (const [entidad, estados, tabla] of MATRICES) {
      for (const de of estados) {
        if ((tabla as Transiciones<string>)[de].length > 0) continue;
        for (const a of estados) {
          expect(() => transicionSuelta(entidad, de, a)).toThrow(
            TransicionInvalidaError,
          );
        }
      }
    }
  });
});

describe('pedido: tabla de transiciones', () => {
  it('cerrado y anulado son terminales; facturado solo cierra', () => {
    expect(PURCHASE_ORDER_TRANSITIONS.cerrado).toEqual([]);
    expect(PURCHASE_ORDER_TRANSITIONS.anulado).toEqual([]);
    expect(PURCHASE_ORDER_TRANSITIONS.facturado).toEqual(['cerrado']);
  });

  it('solo un pedido emitido se puede anular', () => {
    for (const de of PURCHASE_ORDER_STATUSES) {
      expect(puedeTransitar(PURCHASE_ORDER_TRANSITIONS, de, 'anulado')).toBe(
        de === 'emitido',
      );
    }
  });
});

describe('deriveOrderStatus respeta la máquina de estados', () => {
  it('para todo estado/importe/entregado devuelve el actual o una transición legal', () => {
    const importes = [0, 0.01, 1, 100, 1000.5];
    const entregados = [
      -5, 0, 0.005, 0.01, 50, 99.99, 100, 100.01, 1000.5, 5000,
    ];
    for (const actual of PURCHASE_ORDER_STATUSES) {
      for (const importe of importes) {
        for (const entregado of entregados) {
          const next = deriveOrderStatus(actual, importe, entregado);
          expect(
            next === actual ||
              puedeTransitar(PURCHASE_ORDER_TRANSITIONS, actual, next),
          ).toBe(true);
        }
      }
    }
  });
});

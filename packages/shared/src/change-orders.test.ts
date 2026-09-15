import { describe, expect, it } from 'vitest';
import {
  buildChangeOrderNumber,
  canEditChangeOrder,
  canResolveChangeOrder,
  changeOrderCreateSchema,
  changeOrderResolverSchema,
  computeChangeOrderTotal,
  computeLineaImporte,
} from './change-orders';

describe('buildChangeOrderNumber', () => {
  it('compone código de obra + correlativo con 4 dígitos', () => {
    expect(buildChangeOrderNumber('OBR-045', 7)).toBe('OBR-045-CO-0007');
    expect(buildChangeOrderNumber('OBR-001', 123)).toBe('OBR-001-CO-0123');
  });
});

describe('changeOrderCreateSchema', () => {
  it('acepta un alta mínima en borrador con líneas vacías por defecto', () => {
    const result = changeOrderCreateSchema.parse({
      projectId: '11111111-1111-1111-1111-111111111111',
      titulo: 'Cambio de cimentación por roca',
      descripcion: 'Aparece roca no prevista en el estudio geotécnico',
    });
    expect(result.tipo).toBe('contradictorio');
    expect(result.lineas).toEqual([]);
  });

  it('rechaza una línea con cantidad negativa', () => {
    expect(() =>
      changeOrderCreateSchema.parse({
        projectId: '11111111-1111-1111-1111-111111111111',
        titulo: 'x',
        descripcion: 'x',
        lineas: [
          {
            descripcion: 'Excavación en roca',
            unidad: 'm3',
            cantidad: -1,
            precioUnitario: 15,
          },
        ],
      }),
    ).toThrow();
  });
});

describe('changeOrderResolverSchema', () => {
  it('rechaza un estado que no sea aprobado/rechazado', () => {
    expect(() =>
      changeOrderResolverSchema.parse({ estado: 'enviado_df' }),
    ).toThrow();
  });
});

describe('computeLineaImporte / computeChangeOrderTotal', () => {
  it('calcula el importe de una línea a 2 decimales', () => {
    expect(computeLineaImporte(12.5, 33.333)).toBeCloseTo(416.66, 2);
  });

  it('suma el total de todas las líneas', () => {
    expect(computeChangeOrderTotal([{ importe: 100 }, { importe: 50.5 }])).toBe(
      150.5,
    );
  });
});

describe('canEditChangeOrder / canResolveChangeOrder', () => {
  it('solo un borrador se puede editar', () => {
    expect(canEditChangeOrder('borrador')).toBe(true);
    expect(canEditChangeOrder('enviado_df')).toBe(false);
    expect(canEditChangeOrder('aprobado')).toBe(false);
  });

  it('solo un enviado se puede resolver', () => {
    expect(canResolveChangeOrder('enviado_df')).toBe(true);
    expect(canResolveChangeOrder('borrador')).toBe(false);
    expect(canResolveChangeOrder('aprobado')).toBe(false);
  });
});

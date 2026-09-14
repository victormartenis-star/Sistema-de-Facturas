import { describe, expect, it } from 'vitest';
import {
  computeActaEstadoFirma,
  computeRepasosProgreso,
} from './actas-recepcion';

describe('computeActaEstadoFirma', () => {
  it('sin reservas si no hay repasos', () => {
    expect(computeActaEstadoFirma([])).toBe('firmada_sin_reservas');
  });

  it('sin reservas si todos los repasos están subsanados', () => {
    expect(
      computeActaEstadoFirma([
        { estado: 'subsanado' },
        { estado: 'subsanado' },
      ]),
    ).toBe('firmada_sin_reservas');
  });

  it('con reservas si queda algún repaso pendiente', () => {
    expect(
      computeActaEstadoFirma([
        { estado: 'subsanado' },
        { estado: 'pendiente' },
      ]),
    ).toBe('firmada_con_reservas');
  });
});

describe('computeRepasosProgreso', () => {
  it('100% sin repasos', () => {
    expect(computeRepasosProgreso([])).toEqual({
      total: 0,
      subsanados: 0,
      pctSubsanado: 100,
    });
  });

  it('calcula el porcentaje subsanado', () => {
    expect(
      computeRepasosProgreso([
        { estado: 'subsanado' },
        { estado: 'subsanado' },
        { estado: 'pendiente' },
        { estado: 'pendiente' },
      ]),
    ).toEqual({ total: 4, subsanados: 2, pctSubsanado: 50 });
  });
});

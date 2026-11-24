import { describe, expect, it } from 'vitest';
import {
  ErrorStock,
  estadoSolicitudMaterial,
  faltanteLinea,
  planificarReserva,
  planificarServicio,
} from './calculo';
import { transicion } from './maquina-estados';

describe('planificarReserva', () => {
  it('reserva lo disponible y deja el resto como faltante (milésimas exactas)', () => {
    expect(
      planificarReserva({
        solicitada: 10,
        servida: 0,
        reservada: 0,
        disponible: 6.5,
      }),
    ).toEqual({ reservar: '6.500', faltante: '3.500' });
    expect(
      planificarReserva({
        solicitada: '0.3',
        servida: 0,
        reservada: 0,
        disponible: '0.1',
      }),
    ).toEqual({ reservar: '0.100', faltante: '0.200' });
  });

  it('re-reservar solo cubre lo pendiente sin reservar; disponible negativo cuenta como 0', () => {
    expect(
      planificarReserva({
        solicitada: 10,
        servida: 2,
        reservada: 5,
        disponible: 100,
      }),
    ).toEqual({ reservar: '3.000', faltante: '0.000' });
    expect(
      planificarReserva({
        solicitada: 4,
        servida: 0,
        reservada: 0,
        disponible: -2,
      }),
    ).toEqual({ reservar: '0.000', faltante: '4.000' });
  });

  it('una línea incoherente (sobre-reservada) se rechaza', () => {
    expect(() =>
      planificarReserva({
        solicitada: 1,
        servida: 1,
        reservada: 1,
        disponible: 1,
      }),
    ).toThrow(RangeError);
  });
});

describe('planificarServicio', () => {
  it('libera primero lo reservado', () => {
    expect(
      planificarServicio({
        solicitada: 10,
        servida: 0,
        reservada: 6,
        cantidad: 4,
      }),
    ).toEqual({
      liberar: '4.000',
      servidaTras: '4.000',
      reservadaTras: '2.000',
    });
    // Más que lo reservado: el resto sale del stock libre.
    expect(
      planificarServicio({
        solicitada: 10,
        servida: 0,
        reservada: 6,
        cantidad: 8,
      }),
    ).toEqual({
      liberar: '6.000',
      servidaTras: '8.000',
      reservadaTras: '0.000',
    });
  });

  it('no se sirve más de lo pendiente', () => {
    try {
      planificarServicio({
        solicitada: 10,
        servida: 9.5,
        reservada: 0,
        cantidad: 0.501,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as ErrorStock).codigo).toBe('MATERIAL_REQUEST_OVER_SERVED');
      expect((e as ErrorStock).disponible).toBe('0.500');
    }
    expect(() =>
      planificarServicio({
        solicitada: 1,
        servida: 0,
        reservada: 0,
        cantidad: 0,
      }),
    ).toThrow(ErrorStock);
  });
});

describe('estadoSolicitudMaterial y faltante', () => {
  it('abierta → servida en parte → servida; cancelada no cambia', () => {
    const l = (solicitada: number, servida: number) => ({
      solicitada,
      servida,
    });
    expect(estadoSolicitudMaterial('abierta', [l(5, 0), l(2, 0)])).toBe(
      'abierta',
    );
    expect(estadoSolicitudMaterial('abierta', [l(5, 1), l(2, 0)])).toBe(
      'servida_parcial',
    );
    expect(estadoSolicitudMaterial('servida_parcial', [l(5, 5), l(2, 2)])).toBe(
      'servida',
    );
    expect(estadoSolicitudMaterial('cancelada', [l(5, 5)])).toBe('cancelada');
  });

  it('faltante = solicitada − servida − reservada, nunca negativo', () => {
    expect(faltanteLinea({ solicitada: 10, servida: 2, reservada: 5 })).toBe(
      '3.000',
    );
    expect(faltanteLinea({ solicitada: 10, servida: 10, reservada: 0 })).toBe(
      '0.000',
    );
  });

  it('máquina de estados', () => {
    expect(transicion('material_request', 'abierta', 'servida_parcial')).toBe(
      'servida_parcial',
    );
    expect(() =>
      transicion('material_request', 'servida', 'cancelada'),
    ).toThrow();
  });
});

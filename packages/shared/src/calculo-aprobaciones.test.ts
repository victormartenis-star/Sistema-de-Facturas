import { describe, expect, it } from 'vitest';
import {
  evaluarAprobacion,
  exigeReaprobacion,
  impedimentoAprobador,
  reglaAplicable,
  type ReglaUmbral,
} from './calculo';
import { transicion } from './maquina-estados';

const OBRA = 'obra-1';
const r = (
  id: string,
  importeMinimo: string,
  extra: Partial<ReglaUmbral> = {},
): ReglaUmbral => ({
  id,
  operacion: 'pedido_compra',
  importeMinimo,
  projectId: null,
  rolRequerido: 'administracion',
  activa: true,
  ...extra,
});

describe('reglaAplicable', () => {
  const reglas = [
    r('n1', '5000.00'),
    r('n2', '50000.00', { rolRequerido: 'gerente' }),
    r('n3', '250000.00', { rolRequerido: 'admin' }),
    r('inactiva', '1.00', { activa: false }),
    r('factura', '0.01', { operacion: 'factura_compra' }),
  ];
  const op = (importe: string, projectId: string | null = OBRA) =>
    reglaAplicable(reglas, { operacion: 'pedido_compra', projectId, importe })
      ?.id ?? null;

  it('elige el tramo más alto alcanzado, con el umbral inclusivo y al céntimo', () => {
    expect(op('4999.99')).toBeNull();
    expect(op('5000.00')).toBe('n1');
    expect(op('49999.99')).toBe('n1');
    expect(op('50000')).toBe('n2');
    expect(op('1000000')).toBe('n3');
  });

  it('ignora reglas inactivas y de otras operaciones', () => {
    expect(op('100')).toBeNull();
  });

  it('una regla de obra solo aplica a su obra y gana a igual umbral', () => {
    const conObra = [
      ...reglas,
      r('obra', '5000.00', { projectId: OBRA, rolRequerido: 'administracion' }),
      r('otra', '1000.00', { projectId: 'obra-2' }),
    ];
    expect(
      reglaAplicable(conObra, {
        operacion: 'pedido_compra',
        projectId: OBRA,
        importe: 6000,
      })?.id,
    ).toBe('obra');
    expect(
      reglaAplicable(conObra, {
        operacion: 'pedido_compra',
        projectId: 'obra-3',
        importe: 2000,
      }),
    ).toBeNull();
  });

  it('a igual umbral y alcance, la de mayor nivel', () => {
    const empate = [r('a', '100'), r('b', '100', { rolRequerido: 'admin' })];
    expect(
      reglaAplicable(empate, {
        operacion: 'pedido_compra',
        projectId: null,
        importe: 100,
      })?.id,
    ).toBe('b');
  });
});

describe('impedimentoAprobador', () => {
  it('segregación: el solicitante no decide', () => {
    expect(
      impedimentoAprobador({
        aprobadorId: 'u1',
        solicitanteId: 'u1',
        rolAprobador: 'admin',
        rolRequerido: 'administracion',
      }),
    ).toBe('SELF_APPROVAL_FORBIDDEN');
  });
  it('el nivel debe alcanzar el requerido; uno superior vale', () => {
    const base = { aprobadorId: 'u2', solicitanteId: 'u1' };
    expect(
      impedimentoAprobador({
        ...base,
        rolAprobador: 'administracion',
        rolRequerido: 'gerente',
      }),
    ).toBe('APPROVAL_ROLE_INSUFFICIENT');
    expect(
      impedimentoAprobador({
        ...base,
        rolAprobador: 'obra',
        rolRequerido: 'administracion',
      }),
    ).toBe('APPROVAL_ROLE_INSUFFICIENT');
    expect(
      impedimentoAprobador({
        ...base,
        rolAprobador: 'admin',
        rolRequerido: 'gerente',
      }),
    ).toBeNull();
  });
});

describe('evaluarAprobacion', () => {
  const regla = { rolRequerido: 'gerente' as const, importeMinimo: '50000' };

  it('sin regla no se exige nada', () => {
    expect(
      evaluarAprobacion({ regla: null, solicitud: null, importeActual: 1e6 }),
    ).toMatchObject({ requerida: false, errorCode: null });
  });

  it('sin solicitud, pendiente o rechazada bloquea con su código', () => {
    const ev = (
      estado: 'pendiente' | 'rechazada' | 'invalidada' | 'anulada' | null,
    ) =>
      evaluarAprobacion({
        regla,
        solicitud: estado
          ? { estado, importe: '60000', rolRequerido: 'gerente' }
          : null,
        importeActual: '60000',
      }).errorCode;
    expect(ev(null)).toBe('APPROVAL_REQUIRED');
    expect(ev('invalidada')).toBe('APPROVAL_REQUIRED');
    expect(ev('anulada')).toBe('APPROVAL_REQUIRED');
    expect(ev('pendiente')).toBe('APPROVAL_PENDING');
    expect(ev('rechazada')).toBe('APPROVAL_REJECTED');
  });

  it('aprobada cubre el importe aprobado o menor, no uno mayor (céntimo a céntimo)', () => {
    const sol = {
      estado: 'aprobada' as const,
      importe: '60000.00',
      rolRequerido: 'gerente' as const,
    };
    expect(
      evaluarAprobacion({ regla, solicitud: sol, importeActual: '60000.00' })
        .errorCode,
    ).toBeNull();
    expect(
      evaluarAprobacion({ regla, solicitud: sol, importeActual: '59000' })
        .resultado,
    ).toBe('aprobada');
    expect(
      evaluarAprobacion({ regla, solicitud: sol, importeActual: '60000.01' })
        .errorCode,
    ).toBe('APPROVAL_REQUIRED');
  });

  it('si el importe subió de tramo, la aprobación de nivel inferior no basta', () => {
    expect(
      evaluarAprobacion({
        regla: { rolRequerido: 'admin', importeMinimo: '250000' },
        solicitud: {
          estado: 'aprobada',
          importe: '300000',
          rolRequerido: 'gerente',
        },
        importeActual: '300000',
      }).errorCode,
    ).toBe('APPROVAL_REQUIRED');
  });
});

describe('exigeReaprobacion y transiciones', () => {
  it('solo un aumento de importe invalida', () => {
    expect(exigeReaprobacion('1000.00', '1000.01')).toBe(true);
    expect(exigeReaprobacion('1000.00', '999.99')).toBe(false);
    expect(exigeReaprobacion(1000, 1000)).toBe(false);
  });

  it('máquina de estados de la solicitud', () => {
    expect(transicion('approval_request', 'pendiente', 'aprobada')).toBe(
      'aprobada',
    );
    expect(transicion('approval_request', 'aprobada', 'invalidada')).toBe(
      'invalidada',
    );
    expect(() =>
      transicion('approval_request', 'aprobada', 'rechazada'),
    ).toThrow();
    expect(() =>
      transicion('approval_request', 'rechazada', 'aprobada'),
    ).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import {
  hasAnyRechazado,
  isRequestComplete,
  nextRequestEstado,
  signatureRequestCreateSchema,
} from './e-signature';

describe('signatureRequestCreateSchema', () => {
  it('exige al menos un firmante', () => {
    expect(() =>
      signatureRequestCreateSchema.parse({
        entityTipo: 'parte_diario',
        entityId: '11111111-1111-1111-1111-111111111111',
        titulo: 'Parte del 14/09',
        firmantes: [],
      }),
    ).toThrow();
  });

  it('acepta una solicitud mínima con un firmante', () => {
    const result = signatureRequestCreateSchema.parse({
      entityTipo: 'entrega_epi',
      entityId: '11111111-1111-1111-1111-111111111111',
      titulo: 'Entrega de casco y botas',
      firmantes: [{ nombre: 'Juan Pérez' }],
    });
    expect(result.firmantes).toHaveLength(1);
  });
});

describe('isRequestComplete', () => {
  it('false si no hay firmantes', () => {
    expect(isRequestComplete([])).toBe(false);
  });

  it('false si falta alguno por firmar', () => {
    expect(
      isRequestComplete([{ estado: 'firmado' }, { estado: 'pendiente' }]),
    ).toBe(false);
  });

  it('true si todos han firmado', () => {
    expect(
      isRequestComplete([{ estado: 'firmado' }, { estado: 'firmado' }]),
    ).toBe(true);
  });
});

describe('hasAnyRechazado', () => {
  it('true si algún firmante rechazó', () => {
    expect(
      hasAnyRechazado([{ estado: 'firmado' }, { estado: 'rechazado' }]),
    ).toBe(true);
  });

  it('false si nadie rechazó', () => {
    expect(hasAnyRechazado([{ estado: 'firmado' }])).toBe(false);
  });
});

describe('nextRequestEstado', () => {
  it('pasa a completada cuando todos firman', () => {
    expect(nextRequestEstado([{ estado: 'firmado' }], 'pendiente')).toBe(
      'completada',
    );
  });

  it('pasa a cancelada si alguien rechaza', () => {
    expect(
      nextRequestEstado(
        [{ estado: 'firmado' }, { estado: 'rechazado' }],
        'pendiente',
      ),
    ).toBe('cancelada');
  });

  it('se mantiene pendiente si faltan firmas', () => {
    expect(
      nextRequestEstado(
        [{ estado: 'firmado' }, { estado: 'pendiente' }],
        'pendiente',
      ),
    ).toBe('pendiente');
  });

  it('no cambia un estado ya cerrado', () => {
    expect(nextRequestEstado([{ estado: 'firmado' }], 'cancelada')).toBe(
      'cancelada',
    );
  });
});

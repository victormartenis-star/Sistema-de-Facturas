import { describe, expect, it } from 'vitest';
import { phaseCreateSchema, phaseUpdateSchema } from './phases';

describe('phaseCreateSchema', () => {
  it('acepta una partida sin cronograma planificado', () => {
    const result = phaseCreateSchema.parse({ code: '01', name: 'Cimentación' });
    expect(result.plannedStartDate).toBeUndefined();
    expect(result.plannedEndDate).toBeUndefined();
  });

  it('acepta un cronograma planificado válido', () => {
    const result = phaseCreateSchema.parse({
      code: '01',
      name: 'Cimentación',
      plannedStartDate: '2026-01-01',
      plannedEndDate: '2026-03-31',
    });
    expect(result.plannedStartDate).toBe('2026-01-01');
    expect(result.plannedEndDate).toBe('2026-03-31');
  });

  it('rechaza un inicio planificado posterior al fin', () => {
    expect(() =>
      phaseCreateSchema.parse({
        code: '01',
        name: 'Cimentación',
        plannedStartDate: '2026-03-31',
        plannedEndDate: '2026-01-01',
      }),
    ).toThrow();
  });

  it('acepta el mismo día como inicio y fin', () => {
    const result = phaseCreateSchema.parse({
      code: '01',
      name: 'Cimentación',
      plannedStartDate: '2026-01-01',
      plannedEndDate: '2026-01-01',
    });
    expect(result.plannedStartDate).toBe('2026-01-01');
  });
});

describe('phaseUpdateSchema', () => {
  it('rechaza un inicio planificado posterior al fin también en update', () => {
    expect(() =>
      phaseUpdateSchema.parse({
        plannedStartDate: '2026-03-31',
        plannedEndDate: '2026-01-01',
      }),
    ).toThrow();
  });

  it('acepta actualizar solo la fecha de fin', () => {
    const result = phaseUpdateSchema.parse({ plannedEndDate: '2026-05-01' });
    expect(result.plannedEndDate).toBe('2026-05-01');
  });
});

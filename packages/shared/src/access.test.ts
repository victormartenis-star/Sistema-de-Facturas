import { describe, expect, it } from 'vitest';
import { hasAllowedProject, isProjectAllowed } from './access';

describe('isProjectAllowed', () => {
  it('sin restricción (allowed=null) todo es visible', () => {
    expect(isProjectAllowed(null, 'obra-1')).toBe(true);
    expect(isProjectAllowed(null, null)).toBe(true);
  });

  it('con restricción, solo las obras de la lista son visibles', () => {
    expect(isProjectAllowed(['obra-1', 'obra-2'], 'obra-1')).toBe(true);
    expect(isProjectAllowed(['obra-1', 'obra-2'], 'obra-3')).toBe(false);
  });

  it('con restricción, una entidad sin obra asignada no es visible', () => {
    expect(isProjectAllowed(['obra-1'], null)).toBe(false);
  });

  it('con lista de obras accesibles vacía, nada es visible', () => {
    expect(isProjectAllowed([], 'obra-1')).toBe(false);
  });
});

describe('hasAllowedProject', () => {
  it('sin restricción todo es visible', () => {
    expect(hasAllowedProject(null, [])).toBe(true);
    expect(hasAllowedProject(null, [null, 'obra-9'])).toBe(true);
  });

  it('basta con que una de las obras de la lista sea accesible', () => {
    expect(hasAllowedProject(['obra-1'], ['obra-2', 'obra-1'])).toBe(true);
  });

  it('si ninguna obra de la lista es accesible, no es visible', () => {
    expect(hasAllowedProject(['obra-1'], ['obra-2', 'obra-3'])).toBe(false);
  });

  it('lista de obras vacía o solo nulls no es visible con restricción', () => {
    expect(hasAllowedProject(['obra-1'], [])).toBe(false);
    expect(hasAllowedProject(['obra-1'], [null, null])).toBe(false);
  });

  it('sin obras accesibles (rol obra sin ninguna asignada) nunca es visible', () => {
    expect(hasAllowedProject([], ['obra-1'])).toBe(false);
  });
});

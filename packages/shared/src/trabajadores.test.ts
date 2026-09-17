import { describe, expect, it } from 'vitest';
import { trabajadorCreateSchema } from './trabajadores';

describe('trabajadorCreateSchema', () => {
  it('acepta un alta mínima con valores por defecto', () => {
    const result = trabajadorCreateSchema.parse({ nombre: 'Juan Pérez' });
    expect(result.tipo).toBe('propio');
    expect(result.activo).toBe(true);
  });

  it('rechaza nombre vacío', () => {
    expect(() => trabajadorCreateSchema.parse({ nombre: '' })).toThrow();
  });

  it('rechaza un tipo no reconocido', () => {
    expect(() =>
      trabajadorCreateSchema.parse({ nombre: 'Ana', tipo: 'freelance' }),
    ).toThrow();
  });

  it('acepta proveedor cuando el tipo es subcontratado', () => {
    const result = trabajadorCreateSchema.parse({
      nombre: 'Pedro Gómez',
      tipo: 'subcontratado',
      proveedorId: '11111111-1111-1111-1111-111111111111',
    });
    expect(result.proveedorId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('rechaza tarifa negativa', () => {
    expect(() =>
      trabajadorCreateSchema.parse({
        nombre: 'Luis Ruiz',
        ordinaryRateDefault: -5,
      }),
    ).toThrow();
  });

  it('rechaza fecha de alta con formato inválido', () => {
    expect(() =>
      trabajadorCreateSchema.parse({
        nombre: 'María López',
        fechaAlta: '14-09-2026',
      }),
    ).toThrow();
  });
});

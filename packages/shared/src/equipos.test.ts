import { describe, expect, it } from 'vitest';
import { equipoCreateSchema, mantenimientoCreateSchema } from './equipos';

describe('equipoCreateSchema', () => {
  it('acepta un alta mínima con valores por defecto', () => {
    const result = equipoCreateSchema.parse({ nombre: 'Retroexcavadora 12' });
    expect(result.tipo).toBe('maquina_pesada');
    expect(result.ownership).toBe('propia');
    expect(result.estado).toBe('operativo');
  });

  it('rechaza nombre vacío', () => {
    expect(() => equipoCreateSchema.parse({ nombre: '' })).toThrow();
  });

  it('rechaza un tipo de equipo no reconocido', () => {
    expect(() =>
      equipoCreateSchema.parse({ nombre: 'Grúa torre', tipo: 'grua' }),
    ).toThrow();
  });

  it('acepta proveedor de alquiler cuando ownership es alquilada', () => {
    const result = equipoCreateSchema.parse({
      nombre: 'Plataforma elevadora',
      ownership: 'alquilada',
      proveedorAlquilerId: '11111111-1111-1111-1111-111111111111',
    });
    expect(result.proveedorAlquilerId).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
  });

  it('rechaza fecha de alta con formato inválido', () => {
    expect(() =>
      equipoCreateSchema.parse({ nombre: 'Dumper', fechaAlta: '14-09-2026' }),
    ).toThrow();
  });
});

describe('mantenimientoCreateSchema', () => {
  const equipoId = '22222222-2222-2222-2222-222222222222';

  it('acepta un mantenimiento preventivo mínimo', () => {
    const result = mantenimientoCreateSchema.parse({
      equipoId,
      fecha: '2026-09-14',
    });
    expect(result.tipo).toBe('preventivo');
  });

  it('exige que el equipo sea un UUID válido', () => {
    expect(() =>
      mantenimientoCreateSchema.parse({
        equipoId: 'no-es-uuid',
        fecha: '2026-09-14',
      }),
    ).toThrow();
  });

  it('rechaza coste negativo', () => {
    expect(() =>
      mantenimientoCreateSchema.parse({
        equipoId,
        fecha: '2026-09-14',
        coste: -100,
      }),
    ).toThrow();
  });

  it('acepta próxima revisión para preparar el aviso de caducidad', () => {
    const result = mantenimientoCreateSchema.parse({
      equipoId,
      tipo: 'itv',
      fecha: '2026-09-14',
      proximaRevisionFecha: '2027-09-14',
    });
    expect(result.proximaRevisionFecha).toBe('2027-09-14');
  });
});

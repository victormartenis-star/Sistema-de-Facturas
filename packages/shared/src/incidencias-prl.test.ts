import { describe, expect, it } from 'vitest';
import { isIncidenciaFueraDePlazo } from './incidencias-prl';

const HOY = '2026-09-14';

describe('isIncidenciaFueraDePlazo', () => {
  it('false si ya está cerrada, aunque el plazo haya pasado', () => {
    expect(
      isIncidenciaFueraDePlazo(
        { estado: 'cerrada', fechaLimiteSubsanacion: '2026-01-01' },
        HOY,
      ),
    ).toBe(false);
  });

  it('false sin fecha límite', () => {
    expect(
      isIncidenciaFueraDePlazo(
        { estado: 'abierta', fechaLimiteSubsanacion: null },
        HOY,
      ),
    ).toBe(false);
  });

  it('true si sigue abierta y el plazo ya pasó', () => {
    expect(
      isIncidenciaFueraDePlazo(
        { estado: 'en_subsanacion', fechaLimiteSubsanacion: '2026-01-01' },
        HOY,
      ),
    ).toBe(true);
  });

  it('false si el plazo todavía no ha vencido', () => {
    expect(
      isIncidenciaFueraDePlazo(
        { estado: 'abierta', fechaLimiteSubsanacion: '2026-12-31' },
        HOY,
      ),
    ).toBe(false);
  });
});

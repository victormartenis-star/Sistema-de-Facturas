import { describe, expect, it } from 'vitest';
import {
  evaluateTelemetriaAlertas,
  isMantenimientoVencido,
  telemetriaIngestSchema,
} from './fleet-iot';

describe('telemetriaIngestSchema', () => {
  it('acepta una lectura mínima con payload por defecto', () => {
    const result = telemetriaIngestSchema.parse({
      equipoId: '11111111-1111-1111-1111-111111111111',
    });
    expect(result.payload).toEqual({});
  });

  it('rechaza un nivel de combustible fuera de rango', () => {
    expect(() =>
      telemetriaIngestSchema.parse({
        equipoId: '11111111-1111-1111-1111-111111111111',
        combustibleNivelPct: 120,
      }),
    ).toThrow();
  });
});

describe('evaluateTelemetriaAlertas', () => {
  it('no dispara nada con una lectura normal', () => {
    expect(
      evaluateTelemetriaAlertas({
        codigoError: null,
        temperaturaMotor: 85,
        combustibleNivelPct: 60,
      }),
    ).toEqual([]);
  });

  it('dispara avería grave si hay código de error', () => {
    const alertas = evaluateTelemetriaAlertas({ codigoError: 'P0301' });
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({ tipo: 'averia', gravedad: 'grave' });
  });

  it('dispara anomalía crítica con temperatura de motor muy alta', () => {
    const alertas = evaluateTelemetriaAlertas({ temperaturaMotor: 130 });
    expect(alertas[0]).toMatchObject({
      tipo: 'anomalia_telemetria',
      gravedad: 'critica',
    });
  });

  it('dispara anomalía leve con temperatura moderadamente alta', () => {
    const alertas = evaluateTelemetriaAlertas({ temperaturaMotor: 110 });
    expect(alertas[0]).toMatchObject({
      tipo: 'anomalia_telemetria',
      gravedad: 'leve',
    });
  });

  it('dispara anomalía leve con combustible crítico', () => {
    const alertas = evaluateTelemetriaAlertas({ combustibleNivelPct: 3 });
    expect(alertas[0]).toMatchObject({
      tipo: 'anomalia_telemetria',
      gravedad: 'leve',
    });
  });

  it('puede disparar varias alertas a la vez', () => {
    const alertas = evaluateTelemetriaAlertas({
      codigoError: 'P0301',
      temperaturaMotor: 130,
      combustibleNivelPct: 2,
    });
    expect(alertas).toHaveLength(3);
  });
});

describe('isMantenimientoVencido', () => {
  it('es true si la próxima revisión ya pasó', () => {
    expect(isMantenimientoVencido('2026-01-01', '2026-09-14')).toBe(true);
  });

  it('es false si la próxima revisión es futura', () => {
    expect(isMantenimientoVencido('2027-01-01', '2026-09-14')).toBe(false);
  });

  it('es false sin próxima revisión programada', () => {
    expect(isMantenimientoVencido(null, '2026-09-14')).toBe(false);
  });
});

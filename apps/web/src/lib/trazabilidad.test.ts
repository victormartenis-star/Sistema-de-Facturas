import { describe, expect, it } from 'vitest';
import type { AuditAnclaDto } from '@erp/shared';
import {
  etiquetaCertificacionOriginal,
  etiquetaFirmaAncla,
  etiquetaSincronizacion,
  etiquetaXsd,
  hashCorto,
  resumirAnclaje,
} from './trazabilidad';

describe('etiquetaXsd', () => {
  it('muestra Válido, No válido o No disponible según el campo persistido', () => {
    expect(etiquetaXsd('valido')).toBe('Válido');
    expect(etiquetaXsd('no_valido')).toBe('No válido');
    expect(etiquetaXsd(null)).toBe('No disponible');
    expect(etiquetaXsd(undefined)).toBe('No disponible');
  });
});

describe('etiquetaCertificacionOriginal', () => {
  it('usa el número de la original, no el id', () => {
    expect(etiquetaCertificacionOriginal(3)).toBe('Certificación nº 3');
    expect(etiquetaCertificacionOriginal(null)).toBeNull();
  });
});

const ancla = (
  fecha: string,
  firma: AuditAnclaDto['firma'],
  seq = 1,
): AuditAnclaDto => ({
  fecha,
  sequenceNumber: seq,
  entryHash: 'a'.repeat(64),
  firma,
});

describe('etiquetas de anclaje', () => {
  it('traduce firma y sincronización con un tono coherente', () => {
    expect(etiquetaFirmaAncla('valida')).toEqual({
      texto: 'Firmada (HMAC válida)',
      tono: 'ok',
    });
    expect(etiquetaFirmaAncla('invalida').tono).toBe('error');
    expect(etiquetaFirmaAncla('sin_clave').tono).toBe('aviso');
    expect(etiquetaSincronizacion('sincronizada').tono).toBe('ok');
    expect(etiquetaSincronizacion('atrasada').tono).toBe('aviso');
    expect(etiquetaSincronizacion('sin_anclas').texto).toBe(
      'Sin anclas todavía',
    );
  });

  it('abrevia el hash', () => {
    expect(hashCorto('0123456789abcdef')).toBe('0123456789ab…');
    expect(hashCorto('abc')).toBe('abc');
  });
});

describe('resumirAnclaje', () => {
  it('sin anclas: sin última ni firma, estado sin_anclas', () => {
    const r = resumirAnclaje({
      anclas: [],
      ultimaAnclaValidada: null,
      estadoSincronizacion: 'sin_anclas',
    });
    expect(r.ultima).toBeNull();
    expect(r.firma).toBeNull();
    expect(r.historial).toEqual([]);
    expect(r.sincronizacion.texto).toBe('Sin anclas todavía');
  });

  it('toma la más reciente aunque llegue desordenada y limita el historial', () => {
    const r = resumirAnclaje(
      {
        anclas: [
          ancla('2026-11-10', 'valida', 10),
          ancla('2026-11-15', 'invalida', 15),
          ancla('2026-11-12', 'valida', 12),
        ],
        ultimaAnclaValidada: { fecha: '2026-11-12', entryHash: 'x' },
        estadoSincronizacion: 'atrasada',
      },
      2,
    );
    expect(r.ultima?.fecha).toBe('2026-11-15');
    expect(r.firma?.tono).toBe('error');
    expect(r.ultimaValidada).toBe('2026-11-12');
    expect(r.historial.map((a) => a.fecha)).toEqual([
      '2026-11-15',
      '2026-11-12',
    ]);
    expect(r.invalidas).toBe(1);
  });

  it('no repite la última validada si coincide con la más reciente', () => {
    const r = resumirAnclaje({
      anclas: [ancla('2026-11-15', 'valida')],
      ultimaAnclaValidada: { fecha: '2026-11-15', entryHash: 'x' },
      estadoSincronizacion: 'sincronizada',
    });
    expect(r.ultimaValidada).toBeNull();
    expect(r.sincronizacion.tono).toBe('ok');
  });
});

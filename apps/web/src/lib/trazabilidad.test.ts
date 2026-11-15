import { describe, expect, it } from 'vitest';
import { etiquetaCertificacionOriginal, etiquetaXsd } from './trazabilidad';

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

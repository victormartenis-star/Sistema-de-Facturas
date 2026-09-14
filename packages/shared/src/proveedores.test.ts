import { describe, expect, it } from 'vitest';
import { computeDocumentoPRLStatus, validarAptoParaPago } from './proveedores';

const HOY = '2026-09-14';

describe('computeDocumentoPRLStatus', () => {
  it('vigente cuando falta más del horizonte de aviso', () => {
    expect(computeDocumentoPRLStatus('2026-12-31', HOY)).toBe('vigente');
  });

  it('próximo a vencer dentro de los 30 días por defecto', () => {
    expect(computeDocumentoPRLStatus('2026-09-30', HOY)).toBe(
      'proximo_vencimiento',
    );
  });

  it('vencido si la fecha ya pasó', () => {
    expect(computeDocumentoPRLStatus('2026-01-01', HOY)).toBe('vencido');
  });

  it('respeta un horizonte de aviso distinto', () => {
    expect(computeDocumentoPRLStatus('2026-09-20', HOY, 3)).toBe('vigente');
  });
});

describe('validarAptoParaPago', () => {
  it('apto cuando no hay documentos bloqueantes vencidos ni próximos', () => {
    const { apto, razones } = validarAptoParaPago(
      [{ docType: 'plan_seguridad', fechaVencimiento: '2026-12-31' }],
      HOY,
    );
    expect(apto).toBe(true);
    expect(razones).toEqual([]);
  });

  it('no apto si un documento bloqueante está vencido', () => {
    const { apto, razones } = validarAptoParaPago(
      [{ docType: 'seguro_rc', fechaVencimiento: '2026-01-01' }],
      HOY,
    );
    expect(apto).toBe(false);
    expect(razones).toHaveLength(1);
    expect(razones[0]).toContain('seguro_rc');
  });

  it('no apto si un documento bloqueante vence dentro del horizonte', () => {
    const { apto, razones } = validarAptoParaPago(
      [{ docType: 'epi', fechaVencimiento: '2026-09-20' }],
      HOY,
    );
    expect(apto).toBe(false);
    expect(razones[0]).toContain('próximo a vencer');
  });

  it('ignora documentos no bloqueantes vencidos', () => {
    const { apto } = validarAptoParaPago(
      [{ docType: 'otro', fechaVencimiento: '2026-01-01' }],
      HOY,
    );
    expect(apto).toBe(true);
  });
});

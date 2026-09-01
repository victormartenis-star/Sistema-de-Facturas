import { describe, expect, it } from 'vitest';
import {
  BLOCKING_COMPLIANCE_DOC_TYPES,
  COMPLIANCE_WARNING_DAYS,
  complianceDocStatus,
} from './compliance';

const HOY = '2026-06-15';

describe('complianceDocStatus', () => {
  it('un documento rechazado lo está aunque siga en vigor', () => {
    expect(
      complianceDocStatus({ rejected: true, expiresAt: '2030-01-01' }, HOY),
    ).toBe('rechazado');
  });

  it('sin fecha de caducidad el documento es permanente', () => {
    expect(complianceDocStatus({ rejected: false, expiresAt: null }, HOY)).toBe(
      'vigente',
    );
  });

  it('caducado ayer está vencido', () => {
    expect(
      complianceDocStatus({ rejected: false, expiresAt: '2026-06-14' }, HOY),
    ).toBe('vencido');
  });

  it('el día de la caducidad todavía está vigente, avisando', () => {
    expect(complianceDocStatus({ rejected: false, expiresAt: HOY }, HOY)).toBe(
      'proximo_vencimiento',
    );
  });

  it('avisa dentro de la ventana de preaviso y no antes', () => {
    const dentro = '2026-07-15'; // 30 días exactos
    const fuera = '2026-07-16'; // 31 días
    expect(
      complianceDocStatus({ rejected: false, expiresAt: dentro }, HOY),
    ).toBe('proximo_vencimiento');
    expect(
      complianceDocStatus({ rejected: false, expiresAt: fuera }, HOY),
    ).toBe('vigente');
    expect(COMPLIANCE_WARNING_DAYS).toBe(30);
  });

  it('el resultado no depende del reloj: misma entrada, misma salida', () => {
    const doc = { rejected: false, expiresAt: '2026-06-20' };
    expect(complianceDocStatus(doc, '2026-06-15')).toBe('proximo_vencimiento');
    expect(complianceDocStatus(doc, '2026-06-21')).toBe('vencido');
    expect(complianceDocStatus(doc, '2026-01-01')).toBe('vigente');
  });
});

describe('documentos bloqueantes', () => {
  it('el seguro de RC y el certificado de la Seguridad Social bloquean', () => {
    // Responsabilidad solidaria del contratista: sin estos no se paga.
    expect(BLOCKING_COMPLIANCE_DOC_TYPES).toContain('seguro_rc');
    expect(BLOCKING_COMPLIANCE_DOC_TYPES).toContain('certificado_ss');
    expect(BLOCKING_COMPLIANCE_DOC_TYPES).toContain('plan_seguridad');
    expect(BLOCKING_COMPLIANCE_DOC_TYPES).toContain('rea');
  });

  it('los documentos informativos no bloquean', () => {
    expect(BLOCKING_COMPLIANCE_DOC_TYPES).not.toContain('epi');
    expect(BLOCKING_COMPLIANCE_DOC_TYPES).not.toContain('otro');
  });
});

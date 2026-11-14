import { describe, expect, it } from 'vitest';
import {
  CERT_STATUSES,
  CERT_TRANSITIONS,
  type CertStatus,
  canEditCertification,
  canTransitionCertification,
  certificationPctBlockReason,
  certificationRectifySchema,
} from './certifications';

const ESPERADO: Record<CertStatus, Record<CertStatus, boolean>> = {
  borrador: { borrador: false, facturada: true },
  facturada: { borrador: true, facturada: false },
};

describe('certificación: transiciones', () => {
  for (const de of CERT_STATUSES) {
    for (const a of CERT_STATUSES) {
      it(`${de} → ${a}: ${ESPERADO[de][a] ? 'sí' : 'no'}`, () => {
        expect(canTransitionCertification(de, a)).toBe(ESPERADO[de][a]);
      });
    }
  }
  it('la tabla cubre todos los estados', () => {
    expect(Object.keys(CERT_TRANSITIONS).sort()).toEqual(
      [...CERT_STATUSES].sort(),
    );
  });
});

describe('certificación: edición de líneas y borrado', () => {
  it('solo en borrador', () => {
    expect(canEditCertification('borrador')).toBe(true);
    expect(canEditCertification('facturada')).toBe(false);
  });
});

describe('certificationPctBlockReason', () => {
  it('una certificación normal debe superar el % anterior', () => {
    expect(
      certificationPctBlockReason({
        cumulativePct: 30,
        previousPct: 30,
        isRectification: false,
      }),
    ).toMatch(/superar/);
    expect(
      certificationPctBlockReason({
        cumulativePct: 20,
        previousPct: 30,
        isRectification: false,
      }),
    ).not.toBeNull();
    expect(
      certificationPctBlockReason({
        cumulativePct: 31,
        previousPct: 30,
        isRectification: false,
      }),
    ).toBeNull();
  });
  it('una rectificativa puede bajar o igualar, pero no superar', () => {
    expect(
      certificationPctBlockReason({
        cumulativePct: 20,
        previousPct: 30,
        isRectification: true,
      }),
    ).toBeNull();
    expect(
      certificationPctBlockReason({
        cumulativePct: 30,
        previousPct: 30,
        isRectification: true,
      }),
    ).toBeNull();
    expect(
      certificationPctBlockReason({
        cumulativePct: 31,
        previousPct: 30,
        isRectification: true,
      }),
    ).not.toBeNull();
  });
});

describe('certificationRectifySchema', () => {
  it('admite % cero y exige motivo', () => {
    const ok = {
      certDate: '2026-10-01',
      cumulativePct: 0,
      motivo: 'Medición errónea',
      rectificationMotive: 'R4',
      rectificationType: 'I',
      facturaeReasonCode: '16',
    };
    expect(certificationRectifySchema.safeParse(ok).success).toBe(true);
    const { rectificationMotive: _m, ...sinMotivo } = ok;
    const { rectificationType: _t, ...sinTipo } = ok;
    expect(certificationRectifySchema.safeParse(sinMotivo).success).toBe(false);
    expect(certificationRectifySchema.safeParse(sinTipo).success).toBe(false);
    // La certificación rectificativa es por diferencias: el tipo S es incoherente.
    expect(
      certificationRectifySchema.safeParse({ ...ok, rectificationType: 'S' })
        .success,
    ).toBe(false);
    expect(
      certificationRectifySchema.safeParse({ ...ok, rectificationMotive: 'R9' })
        .success,
    ).toBe(false);
    expect(
      certificationRectifySchema.safeParse({ ...ok, motivo: 'no' }).success,
    ).toBe(false);
    expect(
      certificationRectifySchema.safeParse({ ...ok, cumulativePct: -1 })
        .success,
    ).toBe(false);
  });

  it('exige un código de motivo Facturae coherente con el motivo R1-R4', () => {
    const ok = {
      certDate: '2026-10-01',
      cumulativePct: 30,
      motivo: 'Medición errónea',
      rectificationMotive: 'R1',
      rectificationType: 'I',
      facturaeReasonCode: '83',
    };
    expect(certificationRectifySchema.safeParse(ok).success).toBe(true);
    const { facturaeReasonCode: _c, ...sinCodigo } = ok;
    expect(certificationRectifySchema.safeParse(sinCodigo).success).toBe(false);
    // 85 no es de R1; 99 no existe
    for (const facturaeReasonCode of ['85', '99']) {
      const r = certificationRectifySchema.safeParse({
        ...ok,
        facturaeReasonCode,
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0]?.path).toEqual(['facturaeReasonCode']);
      }
    }
    // R2 admite 85; R4 admite cualquiera válido
    expect(
      certificationRectifySchema.safeParse({
        ...ok,
        rectificationMotive: 'R2',
        facturaeReasonCode: '85',
      }).success,
    ).toBe(true);
    expect(
      certificationRectifySchema.safeParse({
        ...ok,
        rectificationMotive: 'R4',
        facturaeReasonCode: '01',
      }).success,
    ).toBe(true);
  });
});

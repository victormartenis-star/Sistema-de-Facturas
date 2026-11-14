import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RECTIFICATION_KINDS,
  RECTIFICATION_MOTIVES,
  RECTIFICATION_MOTIVE_LABELS,
  RECTIFICATION_TYPES,
  RECTIFICATION_TYPE_LABELS,
  rectificationClassificationErrors,
  invoiceRectifyBlockReason,
  invoiceRectifySchema,
  INVOICE_STATUSES,
  INVOICE_TRANSITIONS,
  type InvoiceStatus,
  canDeleteInvoice,
  canEditInvoice,
  canTransitionInvoice,
  invoiceCancelBlockReason,
  invoiceCancelSchema,
  invoiceStatusFromMilestones,
} from './invoices';
import {
  FACTURAE_REASON_CODES,
  allowedFacturaeReasonCodes,
} from './facturae-reason';

// Matriz completa (plan §2.4).
const ESPERADO: Record<InvoiceStatus, Record<InvoiceStatus, boolean>> = {
  borrador: {
    borrador: false,
    aprobada: true,
    pagada: false,
    rectificada: false,
    anulada: true,
  },
  aprobada: {
    borrador: false,
    aprobada: false,
    pagada: true,
    rectificada: true,
    anulada: true,
  },
  pagada: {
    borrador: false,
    aprobada: true,
    pagada: false,
    rectificada: true,
    anulada: false,
  },
  rectificada: {
    borrador: false,
    aprobada: false,
    pagada: false,
    rectificada: false,
    anulada: false,
  },
  anulada: {
    borrador: false,
    aprobada: false,
    pagada: false,
    rectificada: false,
    anulada: false,
  },
};

describe('factura: transiciones', () => {
  for (const de of INVOICE_STATUSES) {
    for (const a of INVOICE_STATUSES) {
      it(`${de} → ${a}: ${ESPERADO[de][a] ? 'sí' : 'no'}`, () => {
        expect(canTransitionInvoice(de, a)).toBe(ESPERADO[de][a]);
      });
    }
  }
  it('la tabla cubre todos los estados', () => {
    expect(Object.keys(INVOICE_TRANSITIONS).sort()).toEqual(
      [...INVOICE_STATUSES].sort(),
    );
  });
});

describe('factura: edición y borrado', () => {
  it('solo en borrador', () => {
    for (const s of INVOICE_STATUSES) {
      expect(canEditInvoice(s)).toBe(s === 'borrador');
      expect(canDeleteInvoice(s)).toBe(s === 'borrador');
    }
  });
});

describe('invoiceCancelBlockReason', () => {
  const sinPagos = { hasPaidMilestones: false };
  it('un borrador se anula siempre', () => {
    expect(
      invoiceCancelBlockReason({
        kind: 'venta',
        status: 'borrador',
        ...sinPagos,
      }),
    ).toBeNull();
    expect(
      invoiceCancelBlockReason({
        kind: 'compra',
        status: 'borrador',
        ...sinPagos,
      }),
    ).toBeNull();
  });
  it('una venta aprobada no se anula: se corrige con rectificativa', () => {
    expect(
      invoiceCancelBlockReason({
        kind: 'venta',
        status: 'aprobada',
        ...sinPagos,
      }),
    ).toMatch(/rectificativa/);
  });
  it('una compra aprobada sin pagos se puede anular', () => {
    expect(
      invoiceCancelBlockReason({
        kind: 'compra',
        status: 'aprobada',
        ...sinPagos,
      }),
    ).toBeNull();
  });
  it('una compra aprobada con un vencimiento pagado no se anula', () => {
    expect(
      invoiceCancelBlockReason({
        kind: 'compra',
        status: 'aprobada',
        hasPaidMilestones: true,
      }),
    ).toMatch(/pag/);
  });
  it('pagada y anulada no se anulan', () => {
    expect(
      invoiceCancelBlockReason({
        kind: 'compra',
        status: 'pagada',
        ...sinPagos,
      }),
    ).not.toBeNull();
    expect(
      invoiceCancelBlockReason({
        kind: 'compra',
        status: 'anulada',
        ...sinPagos,
      }),
    ).not.toBeNull();
  });
});

describe('invoiceCancelSchema', () => {
  it('el motivo es opcional en el esquema (la API lo exige fuera de borrador)', () => {
    expect(invoiceCancelSchema.safeParse({}).success).toBe(true);
    expect(
      invoiceCancelSchema.safeParse({ motivo: 'Error de tecleo' }).success,
    ).toBe(true);
    expect(
      invoiceCancelSchema.safeParse({ motivo: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
});

describe('invoiceStatusFromMilestones', () => {
  it('aprobada/pagada se recalculan según haya vencimientos previstos', () => {
    expect(invoiceStatusFromMilestones('aprobada', true)).toBe('aprobada');
    expect(invoiceStatusFromMilestones('aprobada', false)).toBe('pagada');
    expect(invoiceStatusFromMilestones('pagada', true)).toBe('aprobada');
    expect(invoiceStatusFromMilestones('pagada', false)).toBe('pagada');
  });
  it('no toca borrador ni anulada', () => {
    expect(invoiceStatusFromMilestones('borrador', false)).toBeNull();
    expect(invoiceStatusFromMilestones('anulada', false)).toBeNull();
    expect(invoiceStatusFromMilestones('anulada', true)).toBeNull();
  });
});

describe('INVOICE_STATUSES sincronizado con schema.ts', () => {
  it('coincide, en valores y orden, con el enum invoice_status de la base', () => {
    const schema = readFileSync(
      resolve(__dirname, '../../db/src/schema.ts'),
      'utf8',
    );
    const m = schema.match(/pgEnum\('invoice_status',\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const enumDb = [...(m as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map(
      (x) => x[1],
    );
    expect(enumDb).toEqual([...INVOICE_STATUSES]);
  });
});

describe('invoiceStatusFromMilestones y rectificada', () => {
  it('no toca rectificada', () => {
    expect(invoiceStatusFromMilestones('rectificada', true)).toBeNull();
    expect(invoiceStatusFromMilestones('rectificada', false)).toBeNull();
  });
});

describe('invoiceRectifyBlockReason', () => {
  it('solo se rectifica aprobada o pagada', () => {
    for (const status of ['borrador', 'rectificada', 'anulada'] as const) {
      expect(
        invoiceRectifyBlockReason({ status, isRectification: false }, 'total'),
      ).not.toBeNull();
    }
    for (const status of ['aprobada', 'pagada'] as const) {
      for (const clase of RECTIFICATION_KINDS) {
        expect(
          invoiceRectifyBlockReason({ status, isRectification: false }, clase),
        ).toBeNull();
      }
    }
  });
  it('una rectificativa no se rectifica en total, pero sí por diferencias', () => {
    expect(
      invoiceRectifyBlockReason(
        { status: 'aprobada', isRectification: true },
        'total',
      ),
    ).toMatch(/rectificativa/);
    expect(
      invoiceRectifyBlockReason(
        { status: 'aprobada', isRectification: true },
        'diferencias',
      ),
    ).toBeNull();
  });
});

describe('invoiceRectifySchema', () => {
  const base = {
    issueDate: '2026-10-01',
    motivo: 'Error en la medición',
    rectificationMotive: 'R4',
    rectificationType: 'S',
    facturaeReasonCode: '16',
  };
  // Total ⇔ S; diferencias ⇔ I.
  const dif = { ...base, rectificationType: 'I' };
  const linea = { description: 'Ajuste', baseAmount: -50, vatPct: 21 };
  it('total no admite líneas', () => {
    expect(
      invoiceRectifySchema.safeParse({ ...base, clase: 'total' }).success,
    ).toBe(true);
    expect(
      invoiceRectifySchema.safeParse({
        ...base,
        clase: 'total',
        lines: [linea],
      }).success,
    ).toBe(false);
  });
  it('diferencias exige líneas', () => {
    expect(
      invoiceRectifySchema.safeParse({ ...dif, clase: 'diferencias' }).success,
    ).toBe(false);
    expect(
      invoiceRectifySchema.safeParse({
        ...dif,
        clase: 'diferencias',
        lines: [linea],
      }).success,
    ).toBe(true);
  });
  it('el motivo es obligatorio (5 a 500 caracteres)', () => {
    expect(
      invoiceRectifySchema.safeParse({
        clase: 'total',
        issueDate: '2026-10-01',
        motivo: 'abc',
      }).success,
    ).toBe(false);
  });
});

describe('motivo y tipo oficiales de rectificativa', () => {
  it('constantes y etiquetas', () => {
    expect([...RECTIFICATION_MOTIVES]).toEqual(['R1', 'R2', 'R3', 'R4']);
    expect([...RECTIFICATION_TYPES]).toEqual(['S', 'I']);
    for (const m of RECTIFICATION_MOTIVES) {
      expect(RECTIFICATION_MOTIVE_LABELS[m]).toContain(m);
    }
    expect(RECTIFICATION_TYPE_LABELS).toEqual({
      S: 'Sustitución',
      I: 'Diferencias',
    });
  });

  it('rectification_kind sigue siendo independiente (total/diferencias)', () => {
    expect([...RECTIFICATION_KINDS]).toEqual(['total', 'diferencias']);
  });

  const check = (
    clase: 'total' | 'diferencias',
    motive: string,
    type: string,
  ) =>
    rectificationClassificationErrors({
      esRectificativa: true,
      clase,
      motive,
      type,
    });

  it('casos válidos', () => {
    expect(check('total', 'R1', 'S')).toEqual([]);
    expect(check('diferencias', 'R3', 'I')).toEqual([]);
  });

  it('total+I y diferencias+S son incoherentes', () => {
    expect(check('total', 'R1', 'I')).toHaveLength(1);
    expect(check('diferencias', 'R4', 'S')).toHaveLength(1);
  });

  it('motivo obligatorio y dentro de R1-R4', () => {
    expect(
      rectificationClassificationErrors({
        esRectificativa: true,
        clase: 'total',
        type: 'S',
      }),
    ).toHaveLength(1);
    expect(check('total', 'R5', 'S')).toHaveLength(1);
    expect(check('total', 'r1', 'S')).toHaveLength(1);
  });

  it('tipo obligatorio y dentro de S/I', () => {
    expect(
      rectificationClassificationErrors({
        esRectificativa: true,
        clase: 'total',
        motive: 'R1',
      }),
    ).toHaveLength(1);
    expect(check('total', 'R1', 'X')).toHaveLength(1);
  });

  it('motivo fuera de R1-R4 y tipo fuera de S/I', () => {
    expect(check('diferencias', 'R5', 'I')).toHaveLength(1);
    expect(check('diferencias', 'R1', 'X')).toHaveLength(1);
  });

  it('no se aceptan en facturas que no son rectificativas', () => {
    expect(
      rectificationClassificationErrors({
        esRectificativa: false,
        motive: 'R1',
      }),
    ).toHaveLength(1);
    expect(
      rectificationClassificationErrors({ esRectificativa: false, type: 'S' }),
    ).toHaveLength(1);
    expect(
      rectificationClassificationErrors({
        esRectificativa: false,
        motive: null,
        type: undefined,
      }),
    ).toEqual([]);
  });

  it('invoiceRectifySchema exige motivo y tipo, y valida coherencia', () => {
    const base = {
      clase: 'total',
      issueDate: '2026-10-01',
      motivo: 'Error en la medición',
      facturaeReasonCode: '16',
    };
    expect(invoiceRectifySchema.safeParse(base).success).toBe(false);
    expect(
      invoiceRectifySchema.safeParse({ ...base, rectificationMotive: 'R1' })
        .success,
    ).toBe(false);
    expect(
      invoiceRectifySchema.safeParse({ ...base, rectificationType: 'S' })
        .success,
    ).toBe(false);
    expect(
      invoiceRectifySchema.safeParse({
        ...base,
        rectificationMotive: 'R1',
        rectificationType: 'S',
      }).success,
    ).toBe(true);
    expect(
      invoiceRectifySchema.safeParse({
        ...base,
        rectificationMotive: 'R9',
        rectificationType: 'S',
      }).success,
    ).toBe(false);
    expect(
      invoiceRectifySchema.safeParse({
        ...base,
        rectificationMotive: 'R1',
        rectificationType: 'I',
      }).success,
    ).toBe(false);
  });
  describe('código de motivo Facturae', () => {
    const base = {
      clase: 'total',
      issueDate: '2026-10-01',
      motivo: 'Error en la medición',
      rectificationType: 'S',
    };
    const parse = (rectificationMotive: string, code?: string) =>
      invoiceRectifySchema.safeParse({
        ...base,
        rectificationMotive,
        ...(code !== undefined && { facturaeReasonCode: code }),
      });

    it('es obligatorio', () => {
      for (const m of RECTIFICATION_MOTIVES) {
        expect(parse(m).success).toBe(false);
      }
    });

    it('listas por motivo', () => {
      expect(allowedFacturaeReasonCodes('R1')).toEqual([
        '80',
        '82',
        '83',
        '84',
        '11',
        '12',
        '16',
      ]);
      expect(allowedFacturaeReasonCodes('R2')).toEqual(['85']);
      expect(allowedFacturaeReasonCodes('R3')).toEqual(['85']);
      expect(allowedFacturaeReasonCodes('R4')).toEqual(
        Object.keys(FACTURAE_REASON_CODES),
      );
    });

    it('cada motivo acepta solo sus códigos', () => {
      for (const m of RECTIFICATION_MOTIVES) {
        const allowed = allowedFacturaeReasonCodes(m);
        for (const code of Object.keys(FACTURAE_REASON_CODES)) {
          expect(parse(m, code).success, m + ' ' + code).toBe(
            allowed.includes(code as never),
          );
        }
      }
    });

    it('código fuera de lista da un error claro', () => {
      const r = parse('R2', '80');
      expect(r.success).toBe(false);
      expect(JSON.stringify(r)).toContain(
        'no es válido para el motivo R2: use 85',
      );
    });

    it('código inexistente o heredado del prototipo se rechaza', () => {
      expect(parse('R4', '99').success).toBe(false);
      expect(parse('R4', 'toString').success).toBe(false);
    });

    it('R4 acepta cualquier código válido', () => {
      for (const code of Object.keys(FACTURAE_REASON_CODES)) {
        expect(parse('R4', code).success).toBe(true);
      }
    });
  });
});

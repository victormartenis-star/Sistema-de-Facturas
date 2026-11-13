import { describe, expect, it } from 'vitest';
import {
  DELIVERY_NOTE_STATUSES,
  DELIVERY_NOTE_TRANSITIONS,
  type DeliveryNoteStatus,
  canDeleteDeliveryNote,
  canReturnDeliveryNote,
  canTransitionDeliveryNote,
  deliveryNoteEditBlockReason,
  deliveryNoteReturnSchema,
} from './delivery-notes';

// Matriz completa (plan §2.3), contando transiciones de usuario y de sistema.
const ESPERADO: Record<
  DeliveryNoteStatus,
  Record<DeliveryNoteStatus, boolean>
> = {
  pendiente: { pendiente: false, validado: true, facturado: false },
  validado: { pendiente: true, validado: false, facturado: true },
  facturado: { pendiente: false, validado: true, facturado: false },
};

describe('albarán: transiciones (usuario o sistema)', () => {
  for (const de of DELIVERY_NOTE_STATUSES) {
    for (const a of DELIVERY_NOTE_STATUSES) {
      it(`${de} → ${a}: ${ESPERADO[de][a] ? 'sí' : 'no'}`, () => {
        expect(canTransitionDeliveryNote(de, a)).toBe(ESPERADO[de][a]);
      });
    }
  }
  it('la tabla cubre todos los estados', () => {
    expect(Object.keys(DELIVERY_NOTE_TRANSITIONS).sort()).toEqual(
      [...DELIVERY_NOTE_STATUSES].sort(),
    );
  });
});

describe('albarán: edición', () => {
  it('pendiente: editable', () => {
    expect(
      deliveryNoteEditBlockReason({ status: 'pendiente', invoiceId: null }, [
        'amount',
      ]),
    ).toBeNull();
  });
  it('validado sin factura: solo la descripción', () => {
    const n = { status: 'validado' as const, invoiceId: null };
    expect(deliveryNoteEditBlockReason(n, ['description'])).toBeNull();
    expect(deliveryNoteEditBlockReason(n, ['amount'])).toMatch(/devolver/i);
    expect(
      deliveryNoteEditBlockReason(n, ['description', 'amount']),
    ).not.toBeNull();
  });
  it('validado vinculado a una factura: bloqueado', () => {
    expect(
      deliveryNoteEditBlockReason({ status: 'validado', invoiceId: 'f1' }, [
        'description',
      ]),
    ).toMatch(/factura/);
  });
  it('facturado: bloqueado', () => {
    expect(
      deliveryNoteEditBlockReason({ status: 'facturado', invoiceId: 'f1' }, [
        'description',
      ]),
    ).toMatch(/facturado/);
  });
});

describe('albarán: borrado y devolución', () => {
  it('solo se borra un pendiente', () => {
    expect(
      canDeleteDeliveryNote({ status: 'pendiente', invoiceId: null }),
    ).toBe(true);
    expect(canDeleteDeliveryNote({ status: 'validado', invoiceId: null })).toBe(
      false,
    );
    expect(canDeleteDeliveryNote({ status: 'validado', invoiceId: 'f' })).toBe(
      false,
    );
    expect(canDeleteDeliveryNote({ status: 'facturado', invoiceId: 'f' })).toBe(
      false,
    );
  });
  it('solo se devuelve un validado sin factura', () => {
    expect(canReturnDeliveryNote({ status: 'validado', invoiceId: null })).toBe(
      true,
    );
    expect(canReturnDeliveryNote({ status: 'validado', invoiceId: 'f' })).toBe(
      false,
    );
    expect(
      canReturnDeliveryNote({ status: 'pendiente', invoiceId: null }),
    ).toBe(false);
    expect(canReturnDeliveryNote({ status: 'facturado', invoiceId: 'f' })).toBe(
      false,
    );
  });
  it('el motivo de devolución tiene entre 5 y 500 caracteres', () => {
    const ok = (motivo: unknown) =>
      deliveryNoteReturnSchema.safeParse({ motivo }).success;
    expect(ok('Importe mal')).toBe(true);
    expect(ok('no')).toBe(false);
    expect(ok('x'.repeat(501))).toBe(false);
    expect(deliveryNoteReturnSchema.safeParse({}).success).toBe(false);
  });
});

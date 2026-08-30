import { describe, expect, it } from 'vitest';
import {
  AUDIT_ENTITY_LABELS,
  auditActionLabel,
  auditEntityLabel,
} from './audit';

describe('auditActionLabel', () => {
  it('traduce las acciones que alguien va a buscar', () => {
    expect(auditActionLabel('POST /variations/:id/aprobar')).toBe(
      'Firma de un modificado',
    );
    expect(auditActionLabel('POST /delivery-notes/:id/validar')).toBe(
      'Validación de albarán',
    );
    expect(auditActionLabel('POST /auth/login')).toBe('Inicio de sesión');
  });

  it('la ruta más específica gana a la genérica del módulo', () => {
    // Ambas empiezan por POST /purchase-orders
    expect(auditActionLabel('POST /purchase-orders/:id/cerrar')).toBe(
      'Cierre de pedido',
    );
    expect(auditActionLabel('POST /purchase-orders')).toBe('Emisión de pedido');
  });

  it('una acción sin etiqueta propia cae en el verbo genérico', () => {
    expect(auditActionLabel('PATCH /contacts/:id')).toBe('Modificación');
    expect(auditActionLabel('DELETE /phases/:id')).toBe('Baja');
    expect(auditActionLabel('POST /categories')).toBe('Alta');
  });

  it('un verbo desconocido se muestra tal cual, sin inventar', () => {
    expect(auditActionLabel('HEAD /raro')).toBe('HEAD /raro');
  });
});

describe('auditEntityLabel', () => {
  it('traduce los módulos conocidos', () => {
    expect(auditEntityLabel('purchase-orders')).toBe('Pedidos');
    expect(auditEntityLabel('variations')).toBe('Modificados');
  });

  it('un módulo nuevo aparece con su nombre técnico, no en blanco', () => {
    // Preferible ver "presupuestos" que una celda vacía.
    expect(auditEntityLabel('presupuestos')).toBe('presupuestos');
  });

  it('cubre los módulos que hoy escriben en la API', () => {
    for (const key of [
      'projects',
      'invoices',
      'purchase-orders',
      'delivery-notes',
      'variations',
      'permits',
      'checklist',
      'auth',
    ]) {
      expect(AUDIT_ENTITY_LABELS[key]).toBeTruthy();
    }
  });
});

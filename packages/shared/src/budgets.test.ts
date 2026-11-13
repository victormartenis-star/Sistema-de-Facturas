import { describe, expect, it } from 'vitest';
import {
  BUDGET_STATUSES,
  BUDGET_TRANSITIONS,
  type BudgetStatus,
  budgetEditBlockReason,
  budgetItemEditBlockReason,
  budgetItemStructureBlockReason,
  canDeleteBudget,
  canTransitionBudget,
} from './budgets';

// Matriz completa estado × estado (plan §2.2). Un estado nuevo sin regla rompe el test.
const ESPERADO: Record<BudgetStatus, Record<BudgetStatus, boolean>> = {
  borrador: { borrador: false, activo: true, cerrado: false },
  activo: { borrador: false, activo: false, cerrado: true },
  cerrado: { borrador: false, activo: false, cerrado: false },
};

describe('presupuesto: transiciones', () => {
  for (const de of BUDGET_STATUSES) {
    for (const a of BUDGET_STATUSES) {
      it(`${de} → ${a}: ${ESPERADO[de][a] ? 'sí' : 'no'}`, () => {
        expect(canTransitionBudget(de, a)).toBe(ESPERADO[de][a]);
      });
    }
  }

  it('la tabla cubre todos los estados', () => {
    expect(Object.keys(BUDGET_TRANSITIONS).sort()).toEqual(
      [...BUDGET_STATUSES].sort(),
    );
  });
});

describe('presupuesto: edición de la cabecera', () => {
  it('borrador: nombre y notas', () => {
    expect(budgetEditBlockReason('borrador', ['name', 'notes'])).toBeNull();
  });
  it('activo: solo notas; el nombre no', () => {
    expect(budgetEditBlockReason('activo', ['notes'])).toBeNull();
    expect(budgetEditBlockReason('activo', ['name'])).toMatch(/nombre/);
  });
  it('cerrado: nada', () => {
    expect(budgetEditBlockReason('cerrado', ['notes'])).toMatch(/cerrado/i);
    expect(budgetEditBlockReason('cerrado', ['name'])).not.toBeNull();
  });
  it('sin campos (solo estado) no bloquea', () => {
    expect(budgetEditBlockReason('cerrado', [])).toBeNull();
  });
});

describe('presupuesto: partidas', () => {
  const ECONOMICOS = [
    'unitPrice',
    'quantity',
    'unit',
    'name',
    'level',
    'parentCode',
  ];
  it('borrador: todo editable', () => {
    expect(
      budgetItemEditBlockReason('borrador', [...ECONOMICOS, 'phaseId']),
    ).toBeNull();
  });
  it.each(ECONOMICOS)('activo: %s bloqueado', (campo) => {
    expect(budgetItemEditBlockReason('activo', [campo])).toMatch(
      /nueva versión/,
    );
  });
  it('activo: phaseId y sortOrder sí (imputación analítica)', () => {
    expect(
      budgetItemEditBlockReason('activo', ['phaseId', 'sortOrder']),
    ).toBeNull();
  });
  it('cerrado: todo bloqueado, también phaseId', () => {
    expect(budgetItemEditBlockReason('cerrado', ['phaseId'])).not.toBeNull();
    expect(budgetItemEditBlockReason('cerrado', ['sortOrder'])).not.toBeNull();
  });
  it('crear y borrar partidas solo en borrador', () => {
    expect(budgetItemStructureBlockReason('borrador')).toBeNull();
    expect(budgetItemStructureBlockReason('activo')).toMatch(/nueva versión/);
    expect(budgetItemStructureBlockReason('cerrado')).not.toBeNull();
  });
});

describe('presupuesto: borrado', () => {
  it('solo en borrador', () => {
    expect(canDeleteBudget('borrador')).toBe(true);
    expect(canDeleteBudget('activo')).toBe(false);
    expect(canDeleteBudget('cerrado')).toBe(false);
  });
});

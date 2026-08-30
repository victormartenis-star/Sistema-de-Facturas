import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_ITEMS,
  buildChecklist,
  checklistBlockReason,
  checklistItem,
  checklistSummary,
  type AutoFacts,
  type ManualMark,
} from './checklist';

const marca = (key: ManualMark['key']): ManualMark => ({
  key,
  doneAt: '2026-01-15',
  markedBy: 'Elvira',
  notes: null,
});

describe('definición del checklist', () => {
  it('recoge los quince puntos del anexo A', () => {
    expect(CHECKLIST_ITEMS).toHaveLength(15);
  });

  it('cada punto tiene responsable', () => {
    for (const i of CHECKLIST_ITEMS) {
      expect(i.responsible.length).toBeGreaterThan(0);
    }
  });

  it('los puntos que el sistema comprueba no llevan prerrequisitos manuales', () => {
    // Un automático bloqueado por un manual no se podría desbloquear nunca
    // desde la propia pantalla.
    for (const i of CHECKLIST_ITEMS.filter((x) => x.auto)) {
      expect(i.requires ?? []).toEqual([]);
    }
  });

  it('checklistItem falla con una clave desconocida', () => {
    // @ts-expect-error clave inválida a propósito
    expect(() => checklistItem('inventado')).toThrow();
  });
});

describe('buildChecklist', () => {
  const auto: AutoFacts = {
    codigo_obra: { done: true, detail: 'OBR-045' },
    responsables_asignados: { done: false, detail: 'Falta el Jefe de Grupo' },
    presupuesto_cargado: { done: true, detail: 'Venta, objetivo y 12 meses' },
    licencias_solicitadas: { done: false, detail: 'Sin licencia de obra' },
    acometidas_provisionales: { done: true, detail: 'Agua y luz concedidas' },
    encargado_designado: { done: false, detail: 'Sin encargado' },
  };

  it('toma los puntos automáticos de lo que sabe el sistema', () => {
    const rows = buildChecklist(auto, []);
    const codigo = rows.find((r) => r.key === 'codigo_obra')!;
    expect(codigo.done).toBe(true);
    expect(codigo.detail).toBe('OBR-045');

    const resp = rows.find((r) => r.key === 'responsables_asignados')!;
    expect(resp.done).toBe(false);
    expect(resp.detail).toBe('Falta el Jefe de Grupo');
  });

  it('un punto automático sin dato se considera no cumplido', () => {
    const rows = buildChecklist({}, []);
    expect(rows.find((r) => r.key === 'codigo_obra')!.done).toBe(false);
  });

  it('los puntos manuales dependen de la confirmación guardada', () => {
    const rows = buildChecklist(auto, [marca('contrato_firmado')]);
    const contrato = rows.find((r) => r.key === 'contrato_firmado')!;
    expect(contrato.done).toBe(true);
    expect(contrato.markedBy).toBe('Elvira');
    expect(contrato.doneAt).toBe('2026-01-15');

    expect(rows.find((r) => r.key === 'acta_traspaso')!.done).toBe(false);
  });

  it('marcar a mano no puede dar por bueno un punto automático', () => {
    // Aunque alguien lograra guardar la marca, el sistema manda.
    const rows = buildChecklist(
      {
        ...auto,
        encargado_designado: { done: false, detail: 'Sin encargado' },
      },
      [marca('encargado_designado')],
    );
    expect(rows.find((r) => r.key === 'encargado_designado')!.done).toBe(false);
  });
});

describe('el orden que no se puede invertir', () => {
  it('el acta de aprobación está bloqueada sin plan de seguridad', () => {
    const rows = buildChecklist({}, []);
    const acta = rows.find((r) => r.key === 'acta_aprobacion_plan')!;
    expect(acta.blockedBy).toEqual(['plan_seguridad']);
    expect(checklistBlockReason('acta_aprobacion_plan', rows)).toContain(
      'Plan de seguridad',
    );
  });

  it('la apertura de centro de trabajo está bloqueada sin el acta', () => {
    const rows = buildChecklist({}, [marca('plan_seguridad')]);
    expect(checklistBlockReason('apertura_centro_trabajo', rows)).toContain(
      'Acta de aprobación',
    );
  });

  it('la cadena se desbloquea en orden', () => {
    let rows = buildChecklist({}, [marca('plan_seguridad')]);
    expect(checklistBlockReason('acta_aprobacion_plan', rows)).toBeNull();

    rows = buildChecklist({}, [
      marca('plan_seguridad'),
      marca('acta_aprobacion_plan'),
    ]);
    expect(checklistBlockReason('apertura_centro_trabajo', rows)).toBeNull();
  });

  it('los puntos automáticos no se marcan a mano', () => {
    const rows = buildChecklist({}, []);
    expect(checklistBlockReason('codigo_obra', rows)).toContain(
      'lo comprueba el sistema',
    );
  });

  it('un punto sin prerrequisitos nunca está bloqueado', () => {
    const rows = buildChecklist({}, []);
    expect(checklistBlockReason('contrato_firmado', rows)).toBeNull();
  });
});

describe('checklistSummary', () => {
  it('una obra recién creada no puede arrancar', () => {
    const s = checklistSummary(buildChecklist({}, []));
    expect(s.canStart).toBe(false);
    expect(s.doneCount).toBe(0);
    expect(s.totalCount).toBe(15);
    expect(s.pendingBlockers.length).toBeGreaterThan(0);
  });

  it('los puntos que no bloquean no impiden arrancar', () => {
    // Todo lo bloqueante cumplido; quedan los dos informativos.
    const autoTodo: AutoFacts = Object.fromEntries(
      CHECKLIST_ITEMS.filter((i) => i.auto).map((i) => [
        i.key,
        { done: true, detail: 'ok' },
      ]),
    );
    const manualBloqueantes = CHECKLIST_ITEMS.filter(
      (i) => !i.auto && i.blocksStart,
    ).map((i) => marca(i.key));

    const s = checklistSummary(buildChecklist(autoTodo, manualBloqueantes));
    expect(s.canStart).toBe(true);
    expect(s.doneCount).toBeLessThan(s.totalCount);
  });

  it('cuenta como pendiente el bloqueante que falte, aunque sea uno solo', () => {
    const autoTodo: AutoFacts = Object.fromEntries(
      CHECKLIST_ITEMS.filter((i) => i.auto).map((i) => [
        i.key,
        { done: true, detail: 'ok' },
      ]),
    );
    const manual = CHECKLIST_ITEMS.filter(
      (i) => !i.auto && i.blocksStart && i.key !== 'libro_subcontratacion',
    ).map((i) => marca(i.key));

    const s = checklistSummary(buildChecklist(autoTodo, manual));
    expect(s.canStart).toBe(false);
    expect(s.pendingBlockers.map((r) => r.key)).toEqual([
      'libro_subcontratacion',
    ]);
  });
});

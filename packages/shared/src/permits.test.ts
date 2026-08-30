import { describe, expect, it } from 'vitest';
import {
  BLOCKING_PERMIT_KINDS,
  REFERENCE_LEAD_DAYS,
  assessPermit,
  mustRequestBy,
  permitDaysLate,
  permitStatus,
  type PermitState,
} from './permits';

const HOY = '2026-06-15';

const base: PermitState = {
  kind: 'acometida_agua',
  requestedAt: null,
  committedAt: null,
  grantedAt: null,
  notApplicable: false,
};

describe('permitStatus', () => {
  it('sin solicitar', () => {
    expect(permitStatus(base)).toBe('no_solicitado');
  });

  it('solicitado y sin conceder está en trámite', () => {
    expect(permitStatus({ ...base, requestedAt: '2026-01-10' })).toBe(
      'en_tramite',
    );
  });

  it('concedido', () => {
    expect(
      permitStatus({
        ...base,
        requestedAt: '2026-01-10',
        grantedAt: '2026-05-01',
      }),
    ).toBe('concedido');
  });

  it('"no aplica" manda sobre todo lo demás', () => {
    expect(
      permitStatus({ ...base, requestedAt: '2026-01-10', notApplicable: true }),
    ).toBe('no_aplica');
  });
});

describe('permitDaysLate', () => {
  it('cuenta los días pasados desde la fecha comprometida', () => {
    expect(
      permitDaysLate(
        { ...base, requestedAt: '2026-01-10', committedAt: '2026-05-16' },
        HOY,
      ),
    ).toBe(30);
  });

  it('no hay retraso antes de la fecha comprometida', () => {
    expect(
      permitDaysLate(
        { ...base, requestedAt: '2026-01-10', committedAt: '2026-09-01' },
        HOY,
      ),
    ).toBe(0);
  });

  it('un trámite concedido deja de acumular retraso', () => {
    // Llegó tarde, pero ya está resuelto: seguir contando días solo sirve
    // para ensuciar el semáforo.
    expect(
      permitDaysLate(
        {
          ...base,
          requestedAt: '2026-01-10',
          committedAt: '2026-03-01',
          grantedAt: '2026-04-01',
        },
        HOY,
      ),
    ).toBe(0);
  });

  it('sin fecha comprometida no se puede medir retraso', () => {
    expect(permitDaysLate({ ...base, requestedAt: '2026-01-10' }, HOY)).toBe(0);
  });
});

describe('mustRequestBy', () => {
  it('resta el plazo de referencia del trámite', () => {
    // Acometida de agua: 240 días de tramitación habitual
    expect(mustRequestBy('acometida_agua', '2027-01-01')).toBe('2026-05-06');
  });

  it('la eléctrica definitiva obliga a pedirla dos años antes', () => {
    expect(REFERENCE_LEAD_DAYS.acometida_electrica).toBe(730);
    expect(mustRequestBy('acometida_electrica', '2028-06-15')).toBe(
      '2026-06-16',
    );
  });
});

describe('assessPermit', () => {
  it('un trámite concedido está en verde y sin avisos', () => {
    const a = assessPermit(
      { ...base, requestedAt: '2025-01-10', grantedAt: '2026-01-10' },
      HOY,
      '2027-01-01',
    );
    expect(a.light).toBe('verde');
    expect(a.reasons).toEqual([]);
    expect(a.daysLate).toBe(0);
  });

  it('"no aplica" no genera semáforo', () => {
    const a = assessPermit({ ...base, notApplicable: true }, HOY, '2026-07-01');
    expect(a.light).toBe('verde');
    expect(a.status).toBe('no_aplica');
  });

  it('pasada la fecha comprometida se pone en rojo', () => {
    const a = assessPermit(
      { ...base, requestedAt: '2026-01-10', committedAt: '2026-05-16' },
      HOY,
      '2027-01-01',
    );
    expect(a.light).toBe('rojo');
    expect(a.daysLate).toBe(30);
    expect(a.reasons[0]).toContain('30 días de retraso');
  });

  it('a menos de un mes del compromiso avisa en ámbar', () => {
    const a = assessPermit(
      { ...base, requestedAt: '2026-01-10', committedAt: '2026-07-05' },
      HOY,
      '2027-01-01',
    );
    expect(a.light).toBe('ambar');
    expect(a.daysToCommitted).toBe(20);
  });

  it('en trámite y con margen amplio se queda en verde', () => {
    const a = assessPermit(
      { ...base, requestedAt: '2026-01-10', committedAt: '2026-12-01' },
      HOY,
      '2027-01-01',
    );
    expect(a.light).toBe('verde');
    expect(a.reasons).toEqual([]);
  });

  it('el aviso temprano: sin solicitar y ya no llega a tiempo', () => {
    // Acometida de agua (240 días) para una obra que acaba en 4 meses.
    // No acumula ni un día de retraso, pero ya llega tarde.
    const a = assessPermit(base, HOY, '2026-10-15');
    expect(a.daysLate).toBe(0);
    expect(a.light).toBe('rojo');
    expect(a.reasons[0]).toContain('debería haberse pedido hace');
    expect(a.requestSlackDays).toBeLessThan(0);
  });

  it('sin solicitar pero todavía a tiempo, con poco margen: ámbar', () => {
    // Límite para pedirla: 2027-06-15 − 240 días = 2026-10-18. Si hoy fuese
    // 2026-10-01 quedarían 17 días.
    const a = assessPermit(base, '2026-10-01', '2027-06-15');
    expect(a.light).toBe('ambar');
    expect(a.requestSlackDays).toBe(17);
    expect(a.reasons[0]).toContain('quedan 17 días');
  });

  it('sin solicitar y con mucho margen: verde', () => {
    const a = assessPermit(base, HOY, '2028-01-01');
    expect(a.light).toBe('verde');
    expect(a.reasons).toEqual([]);
  });

  it('sin fecha objetivo solo puede juzgar el retraso ya acumulado', () => {
    const a = assessPermit(base, HOY, null);
    expect(a.light).toBe('verde');
    expect(a.requestDeadline).toBeNull();
    expect(a.requestSlackDays).toBeNull();
  });

  it('el rojo por retraso no lo rebaja un aviso ámbar posterior', () => {
    // Retrasado sobre el compromiso: aunque hubiera otro motivo más leve,
    // el semáforo se queda en el peor de los dos.
    const a = assessPermit(
      { ...base, requestedAt: '2026-01-10', committedAt: '2026-01-20' },
      HOY,
      '2026-07-01',
    );
    expect(a.light).toBe('rojo');
  });
});

describe('trámites bloqueantes', () => {
  it('sin licencia de obra ni provisionales no se empieza', () => {
    expect(BLOCKING_PERMIT_KINDS).toContain('licencia_obra');
    expect(BLOCKING_PERMIT_KINDS).toContain('acometida_agua_provisional');
    expect(BLOCKING_PERMIT_KINDS).toContain('acometida_electrica_provisional');
  });

  it('las definitivas no bloquean el arranque', () => {
    // Se ejecuta con las provisionales mientras llega la definitiva.
    expect(BLOCKING_PERMIT_KINDS).not.toContain('acometida_electrica');
    expect(BLOCKING_PERMIT_KINDS).not.toContain('acometida_agua');
  });
});

import { describe, expect, it } from 'vitest';
import {
  MANUAL_COST_CONCEPTS,
  daysToOpen,
  isExternalCause,
  stoppageDays,
  stoppageReportWarnings,
  stoppageStatus,
  stoppageWarnings,
  valueStoppage,
  type StoppageCostLine,
  type StoppageDto,
  type StoppageState,
} from './stoppages';

const HOY = '2026-09-02';

/** Valoración típica de una obra parada: los cuatro conceptos del manual. */
const costes: StoppageCostLine[] = [
  { concept: 'indirectos', description: null, dailyAmount: 320 },
  { concept: 'medios_auxiliares', description: 'Grúa torre', dailyAmount: 210 },
  { concept: 'personal', description: '2 oficiales', dailyAmount: 340 },
  { concept: 'alquileres', description: 'Casetas y vallado', dailyAmount: 95 },
];

describe('stoppageDays', () => {
  it('cuenta días naturales, con el primero y el último incluidos', () => {
    // La grúa y la caseta se pagan también el domingo.
    expect(stoppageDays('2026-08-03', '2026-08-09', HOY)).toBe(7);
  });

  it('una obra parada un solo día es un día, no cero', () => {
    expect(stoppageDays('2026-08-03', '2026-08-03', HOY)).toBe(1);
  });

  it('mientras sigue parada cuenta hasta hoy', () => {
    expect(stoppageDays('2026-08-24', null, HOY)).toBe(10);
  });

  it('una parada que empieza mañana todavía no lleva días', () => {
    expect(stoppageDays('2026-09-10', null, HOY)).toBe(0);
  });
});

describe('daysToOpen', () => {
  it('abrir el mismo día es cero', () => {
    expect(daysToOpen('2026-08-03', '2026-08-03')).toBe(0);
  });

  it('abrirlo tarde deja el retraso a la vista', () => {
    expect(daysToOpen('2026-08-03', '2026-08-17')).toBe(14);
  });
});

describe('valueStoppage', () => {
  it('el acumulado sale del coste diario por los días', () => {
    const v = valueStoppage(costes, 10);
    expect(v.dailyTotal).toBe(965);
    expect(v.accruedTotal).toBe(9_650);
  });

  it('desglosa el acumulado por concepto', () => {
    const v = valueStoppage(costes, 10);
    const grua = v.lines.find((l) => l.concept === 'medios_auxiliares');
    expect(grua?.total).toBe(2_100);
  });

  it('con cero días valorados no hay acumulado, pero sí coste diario', () => {
    // Es el caso de la parada que empieza hoy: todavía no ha costado nada,
    // pero ya se sabe lo que va a costar cada día.
    const v = valueStoppage(costes, 0);
    expect(v.accruedTotal).toBe(0);
    expect(v.dailyTotal).toBe(965);
  });

  it('avisa de los conceptos del manual que nadie ha valorado', () => {
    const v = valueStoppage([costes[0]], 5);
    expect(v.missingConcepts).toEqual([
      'medios_auxiliares',
      'personal',
      'alquileres',
    ]);
  });

  it('un concepto a cero cuenta como no valorado', () => {
    // Poner 0 € y dejarlo así no es haberlo valorado: es no haberlo mirado.
    const v = valueStoppage(
      costes.map((c) =>
        c.concept === 'alquileres' ? { ...c, dailyAmount: 0 } : c,
      ),
      5,
    );
    expect(v.missingConcepts).toEqual(['alquileres']);
  });

  it('sin ninguna línea faltan los cuatro del manual', () => {
    expect(valueStoppage([], 5).missingConcepts).toEqual(MANUAL_COST_CONCEPTS);
  });
});

describe('causa ajena', () => {
  it('todo lo que no es nuestro es causa ajena', () => {
    expect(isExternalCause('propiedad')).toBe(true);
    expect(isExternalCause('fuerza_mayor')).toBe(true);
  });

  it('lo imputable al contratista no lo es', () => {
    expect(isExternalCause('contratista')).toBe(false);
  });
});

describe('estado', () => {
  it('sin fecha de reanudación la obra sigue parada', () => {
    expect(stoppageStatus(null)).toBe('abierta');
    expect(stoppageStatus('2026-08-20')).toBe('reanudada');
  });
});

describe('stoppageWarnings', () => {
  const base = (p: Partial<StoppageState> = {}): StoppageState => ({
    startDate: '2026-08-24',
    endDate: null,
    openedAt: '2026-08-24',
    attribution: 'propiedad',
    notifiedAt: '2026-08-24',
    claimedAmount: null,
    valuation: valueStoppage(costes, 10),
    ...p,
  });

  it('un expediente abierto el mismo día y comunicado no se reprocha', () => {
    const w = stoppageWarnings(base());
    expect(w.join(' ')).not.toContain('después de la parada');
    expect(w.join(' ')).not.toContain('No consta comunicación');
  });

  it('avisa de haberlo abierto tarde', () => {
    const w = stoppageWarnings(base({ openedAt: '2026-09-01' })).join(' ');
    expect(w).toContain('8 día(s) después de la parada');
    expect(w).toContain('reconstruirlo después');
  });

  it('sin coste valorado dice que no sirve para reclamar', () => {
    const w = stoppageWarnings(base({ valuation: valueStoppage([], 10) })).join(
      ' ',
    );
    expect(w).toContain('no sirve para reclamar');
  });

  it('con algún concepto sin valorar lo enumera', () => {
    const w = stoppageWarnings({
      ...base(),
      valuation: valueStoppage(costes.slice(0, 2), 10),
    }).join(' ');
    expect(w).toContain('personal');
    expect(w).toContain('alquileres');
  });

  it('sin comunicación formal, para la otra parte no ocurrió', () => {
    const w = stoppageWarnings(base({ notifiedAt: null })).join(' ');
    expect(w).toContain('no ocurrió');
  });

  it('si la parada es nuestra no reclama comunicación', () => {
    const w = stoppageWarnings(
      base({ attribution: 'contratista', notifiedAt: null }),
    ).join(' ');
    expect(w).not.toContain('No consta comunicación');
    expect(w).toContain('no hay reclamación que preparar');
  });

  it('mientras sigue parada dice lo que cuesta cada día', () => {
    const w = stoppageWarnings(base()).join(' ');
    expect(w).toContain('965,00 €');
    expect(w).toContain('cada día natural');
  });

  it('reanudada y sin reclamar, avisa del importe que queda en el aire', () => {
    const w = stoppageWarnings(
      base({ endDate: '2026-09-02', claimedAmount: null }),
    ).join(' ');
    expect(w).toContain('9650,00 €');
    expect(w).toContain('sin reclamar');
  });

  it('reanudada y ya reclamada no insiste', () => {
    const w = stoppageWarnings(
      base({ endDate: '2026-09-02', claimedAmount: 9_650 }),
    ).join(' ');
    expect(w).not.toContain('sin reclamar');
  });
});

describe('stoppageReportWarnings', () => {
  const parte = (p: Partial<StoppageDto> = {}): StoppageDto =>
    ({
      stoppageNumber: 'OBR-052-CESE-0001',
      externalCause: true,
      claimedAmount: null,
      daysToOpen: 0,
      status: 'reanudada',
      valuation: valueStoppage(costes, 10),
      ...p,
    }) as StoppageDto;

  it('una obra sin paradas no genera avisos', () => {
    expect(stoppageReportWarnings([])).toEqual([]);
  });

  it('suma el coste diario de las paradas abiertas', () => {
    const w = stoppageReportWarnings([
      parte({ status: 'abierta' }),
      parte({ status: 'abierta' }),
    ]).join(' ');
    expect(w).toContain('2 parada(s) sin reanudar');
    expect(w).toContain('1930,00 €');
  });

  it('suma lo reclamable pendiente y nombra los expedientes', () => {
    const w = stoppageReportWarnings([parte()]).join(' ');
    expect(w).toContain('9650,00 €');
    expect(w).toContain('OBR-052-CESE-0001');
  });

  it('lo imputable a nosotros no entra en lo reclamable', () => {
    const w = stoppageReportWarnings([parte({ externalCause: false })]).join(
      ' ',
    );
    expect(w).not.toContain('sin reclamar');
  });

  it('cuenta los expedientes abiertos tarde', () => {
    const w = stoppageReportWarnings([
      parte({ daysToOpen: 5 }),
      parte({ daysToOpen: 0 }),
    ]).join(' ');
    expect(w).toContain('1 expediente(s) se abrieron después');
  });
});

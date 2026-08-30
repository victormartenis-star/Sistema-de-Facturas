import { describe, expect, it } from 'vitest';
import {
  buildVariationNumber,
  computeBudgetImpact,
  deriveVariationStatus,
  variationAge,
  variationWarnings,
  type VariationAmounts,
} from './variations';

const HOY = '2026-06-15';

describe('numeración', () => {
  it('sigue el mismo patrón que los pedidos', () => {
    expect(buildVariationNumber('OBR-045', 3)).toBe('OBR-045-MOD-0003');
  });
});

describe('deriveVariationStatus', () => {
  it('hacen falta las dos aprobaciones', () => {
    expect(
      deriveVariationStatus({
        dfApprovedAt: '2026-05-01',
        ownerApprovedAt: '2026-05-10',
        rejectedAt: null,
      }),
    ).toBe('aprobado');
  });

  it('solo con la Dirección Facultativa sigue pendiente', () => {
    // Es el caso que más se confunde: el visto bueno técnico no es el
    // compromiso económico de quien paga.
    expect(
      deriveVariationStatus({
        dfApprovedAt: '2026-05-01',
        ownerApprovedAt: null,
        rejectedAt: null,
      }),
    ).toBe('pendiente');
  });

  it('solo con la Propiedad también sigue pendiente', () => {
    expect(
      deriveVariationStatus({
        dfApprovedAt: null,
        ownerApprovedAt: '2026-05-10',
        rejectedAt: null,
      }),
    ).toBe('pendiente');
  });

  it('el rechazo manda sobre cualquier aprobación previa', () => {
    expect(
      deriveVariationStatus({
        dfApprovedAt: '2026-05-01',
        ownerApprovedAt: '2026-05-10',
        rejectedAt: '2026-05-20',
      }),
    ).toBe('rechazado');
  });

  it('sin nada registrado está pendiente', () => {
    expect(
      deriveVariationStatus({
        dfApprovedAt: null,
        ownerApprovedAt: null,
        rejectedAt: null,
      }),
    ).toBe('pendiente');
  });
});

describe('computeBudgetImpact', () => {
  // El ejemplo del manual, con sus cifras
  const ejemplo: VariationAmounts[] = [
    {
      status: 'pendiente',
      salesVariation: 180_000,
      costVariation: 150_000,
      executed: false,
    }, // Estructura: exceso de acero
    {
      status: 'aprobado',
      salesVariation: 45_000,
      costVariation: 38_000,
      executed: true,
    }, // Soleras
    {
      status: 'aprobado',
      salesVariation: -35_000,
      costVariation: -30_000,
      executed: true,
    }, // Carpintería: cambio de calidad
    {
      status: 'pendiente',
      salesVariation: -25_000,
      costVariation: -20_000,
      executed: false,
    }, // Urbanización: eliminación
  ];

  it('reproduce el cuadro de impacto del manual', () => {
    const i = computeBudgetImpact(10_000_000, ejemplo);
    expect(i.approvedIncrease).toBe(45_000);
    expect(i.approvedDecrease).toBe(-35_000);
    expect(i.updatedBudget).toBe(10_010_000);
    expect(i.pendingIncrease).toBe(180_000);
    expect(i.pendingDecrease).toBe(-25_000);
    expect(i.potentialImpact).toBe(155_000);
  });

  it('el presupuesto potencial suma lo pendiente al actualizado', () => {
    const i = computeBudgetImpact(10_000_000, ejemplo);
    expect(i.potentialBudget).toBe(10_165_000);
  });

  it('lo rechazado no entra en ninguna suma', () => {
    const conRechazo = computeBudgetImpact(10_000_000, [
      ...ejemplo,
      {
        status: 'rechazado',
        salesVariation: 500_000,
        costVariation: 400_000,
        executed: false,
      },
    ]);
    const sinRechazo = computeBudgetImpact(10_000_000, ejemplo);
    expect(conRechazo.updatedBudget).toBe(sinRechazo.updatedBudget);
    expect(conRechazo.potentialImpact).toBe(sinRechazo.potentialImpact);
  });

  it('destaca el coste ejecutado sin aprobar', () => {
    const i = computeBudgetImpact(10_000_000, [
      {
        status: 'pendiente',
        salesVariation: 180_000,
        costVariation: 150_000,
        executed: true, // ya se está haciendo
      },
      {
        status: 'aprobado',
        salesVariation: 45_000,
        costVariation: 38_000,
        executed: true,
      },
    ]);
    // Solo el pendiente ejecutado: el aprobado sí tiene ingreso detrás
    expect(i.executedNotApprovedCost).toBe(150_000);
    expect(i.executedNotApprovedCount).toBe(1);
  });

  it('un modificado rechazado y ya ejecutado también cuenta como coste perdido', () => {
    const i = computeBudgetImpact(1_000_000, [
      {
        status: 'rechazado',
        salesVariation: 80_000,
        costVariation: 70_000,
        executed: true,
      },
    ]);
    expect(i.executedNotApprovedCost).toBe(70_000);
  });

  it('una obra sin modificaciones deja el presupuesto intacto', () => {
    const i = computeBudgetImpact(10_000_000, []);
    expect(i.updatedBudget).toBe(10_000_000);
    expect(i.potentialImpact).toBe(0);
    expect(i.executedNotApprovedCost).toBe(0);
  });
});

describe('variationAge', () => {
  it('cuenta los días desde la solicitud', () => {
    expect(variationAge('2026-05-16', HOY)).toBe(30);
  });

  it('una fecha futura no da antigüedad negativa', () => {
    expect(variationAge('2026-07-01', HOY)).toBe(0);
  });
});

describe('variationWarnings', () => {
  const base = {
    variationNumber: 'OBR-045-MOD-0001',
    status: 'pendiente' as const,
    executed: false,
    clientOrderRef: 'Correo de la propiedad 12/05',
    costVariation: 150_000,
    requestedAt: '2026-06-01',
    dfApprovedAt: null,
    ownerApprovedAt: null,
  };

  it('avisa del coste que corre sin ingreso', () => {
    const w = variationWarnings({ ...base, executed: true }, HOY);
    expect(w[0]).toContain('sin aprobación');
    // El importe va formateado en español, igual que en la interfaz
    expect(w[0]).toContain('150.000,00 €');
  });

  it('avisa si se ejecuta algo ya rechazado', () => {
    const w = variationWarnings(
      { ...base, executed: true, status: 'rechazado' },
      HOY,
    );
    expect(w.join(' ')).toContain('no se va a cobrar');
  });

  it('exige orden escrita para el trabajo fuera de contrato', () => {
    const w = variationWarnings(
      { ...base, executed: true, clientOrderRef: null },
      HOY,
    );
    expect(w.join(' ')).toContain('sin orden escrita del cliente');
  });

  it('escala el pendiente que pasa de 60 días', () => {
    const w = variationWarnings({ ...base, requestedAt: '2026-04-01' }, HOY);
    expect(w.join(' ')).toContain('escalarlo formalmente a la Propiedad');
  });

  it('a los 60 días justos todavía no escala', () => {
    const w = variationWarnings({ ...base, requestedAt: '2026-04-16' }, HOY);
    expect(variationAge('2026-04-16', HOY)).toBe(60);
    expect(w.join(' ')).not.toContain('escalarlo');
  });

  it('distingue qué firma falta', () => {
    const soloDf = variationWarnings(
      { ...base, dfApprovedAt: '2026-06-05' },
      HOY,
    );
    expect(soloDf.join(' ')).toContain('no por la Propiedad');

    const soloPropiedad = variationWarnings(
      { ...base, ownerApprovedAt: '2026-06-05' },
      HOY,
    );
    expect(soloPropiedad.join(' ')).toContain('falta la Dirección Facultativa');
  });

  it('un modificado aprobado y en marcha no genera avisos', () => {
    const w = variationWarnings(
      {
        ...base,
        status: 'aprobado',
        executed: true,
        dfApprovedAt: '2026-06-05',
        ownerApprovedAt: '2026-06-08',
      },
      HOY,
    );
    expect(w).toEqual([]);
  });
});

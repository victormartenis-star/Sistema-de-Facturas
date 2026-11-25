import { describe, expect, it } from 'vitest';
import { conciliar, saldoTerceroAFecha } from './calculo';
import { avisosDevengoAutomatico, motivoOmisionMes } from './avales';

describe('saldo de terceros a fecha con retención de garantía', () => {
  it('separa ordinario (4300/4000) y retención (4301/4001), vencida y no vencida', () => {
    // Dos facturas: 1.210 con 50 retenidos (libera 2026-09-01) y 605 con 25
    // (libera 2027-03-01). Cobrado ordinario 500; liberada la 1.ª parcialmente (20).
    const s = saldoTerceroAFecha({
      fecha: '2026-12-31',
      facturado: '1815.00',
      retenido: '75.00',
      liquidadoOrdinario: 500,
      liquidadoRetencion: 20,
      retenciones: [
        { importe: 50, liquidado: 20, vencimiento: '2026-09-01' },
        { importe: '25', liquidado: 0, vencimiento: '2027-03-01' },
      ],
    });
    expect(s).toEqual({
      ordinario: 1240,
      retencion: 55,
      retencionVencida: 30,
      retencionNoVencida: 25,
      total: 1295,
    });
  });

  it('céntimos exactos y saldo de signo contrario (sobrecobro) sin forzar a cero', () => {
    const s = saldoTerceroAFecha({
      fecha: '2026-06-30',
      facturado: '0.30',
      retenido: '0.10',
      liquidadoOrdinario: '0.25',
      liquidadoRetencion: 0,
      retenciones: [
        { importe: '0.10', liquidado: 0, vencimiento: '2026-06-30' },
      ],
    });
    expect(s).toEqual({
      ordinario: -0.05,
      retencion: 0.1,
      retencionVencida: 0.1,
      retencionNoVencida: 0,
      total: 0.05,
    });
  });

  it('una reclasificación entre 4300 y 4301 descuadra las dos partidas aunque el total cuadre', () => {
    const r = conciliar([
      {
        clave: 'clientes',
        etiqueta: 'Ordinario',
        cuentas: '4300',
        auxiliar: 1160,
        mayor: 1210,
      },
      {
        clave: 'clientes_retenciones',
        etiqueta: 'Retención',
        cuentas: '4301',
        auxiliar: 50,
        mayor: 0,
        detalle: [{ clave: 'vencida', concepto: 'Vencida', importe: '50' }],
      },
    ]);
    expect(r.descuadres).toBe(2);
    expect(r.partidas[1]).toMatchObject({
      diferencia: -50,
      detalle: [{ clave: 'vencida', concepto: 'Vencida', importe: 50 }],
    });
    expect('detalle' in r.partidas[0]).toBe(false);
  });
});

describe('avisos de meses omitidos en el devengo automático', () => {
  const mes = (
    periodo: string,
    x: Partial<{
      candidatos: number;
      contabilizados: number;
      yaDevengados: number;
      omitidos: { codigo?: string }[];
    }> = {},
  ) => ({
    periodo,
    candidatos: 0,
    contabilizados: 0,
    yaDevengados: 0,
    omitidos: [],
    ...x,
  });

  it('clasifica cada mes por su motivo', () => {
    expect(
      motivoOmisionMes(mes('2026-01', { candidatos: 2, contabilizados: 2 })),
    ).toBeNull();
    expect(
      motivoOmisionMes(mes('2026-01', { candidatos: 2, yaDevengados: 2 })),
    ).toEqual({
      motivo: 'ya_devengado',
      casos: 2,
    });
    expect(motivoOmisionMes(mes('2026-01'))).toEqual({
      motivo: 'sin_avales',
      casos: 0,
    });
    // Con rechazos es alerta aunque devengara otros; manda el ejercicio cerrado.
    expect(
      motivoOmisionMes(
        mes('2026-01', {
          candidatos: 3,
          contabilizados: 1,
          omitidos: [
            { codigo: 'FISCAL_PERIOD_CLOSED' },
            { codigo: 'FISCAL_YEAR_CLOSED' },
          ],
        }),
      ),
    ).toEqual({ motivo: 'ejercicio_cerrado', casos: 2 });
    expect(
      motivoOmisionMes(mes('2026-01', { omitidos: [{ codigo: 'X' }, {}] })),
    ).toEqual({
      motivo: 'rechazado',
      casos: 2,
    });
  });

  it('agrupa meses consecutivos con el mismo motivo y marca el nivel', () => {
    const avisos = avisosDevengoAutomatico(
      [
        mes('2026-03', { candidatos: 1, yaDevengados: 1 }),
        mes('2026-04', { candidatos: 1, yaDevengados: 1 }),
        mes('2026-05', {
          candidatos: 1,
          omitidos: [{ codigo: 'FISCAL_PERIOD_CLOSED' }],
        }),
        mes('2026-06', { candidatos: 1, contabilizados: 1 }),
        mes('2026-07', {
          candidatos: 2,
          omitidos: [
            { codigo: 'FISCAL_PERIOD_CLOSED' },
            { codigo: 'FISCAL_PERIOD_CLOSED' },
          ],
        }),
        mes('2026-08', { candidatos: 2, yaDevengados: 2 }),
      ],
      [
        { periodo: '2026-01', pendientes: 1 },
        { periodo: '2026-02', pendientes: 0 },
      ],
    );
    expect(avisos).toEqual([
      {
        desde: '2026-01',
        hasta: '2026-01',
        meses: 1,
        motivo: 'fuera_de_ventana',
        nivel: 'alerta',
        casos: 1,
        detalle:
          '2026-01: Fuera de la ventana del devengo automático (1 aval·mes); devéngalos a mano con POST /avales/devengos.',
      },
      expect.objectContaining({
        desde: '2026-03',
        hasta: '2026-04',
        meses: 2,
        motivo: 'ya_devengado',
        nivel: 'info',
        casos: 2,
      }),
      expect.objectContaining({
        desde: '2026-05',
        hasta: '2026-05',
        motivo: 'periodo_cerrado',
        nivel: 'alerta',
        casos: 1,
      }),
      // Junio se devengó: corta el rango de período cerrado.
      expect.objectContaining({
        desde: '2026-07',
        hasta: '2026-07',
        motivo: 'periodo_cerrado',
        casos: 2,
      }),
      expect.objectContaining({ desde: '2026-08', motivo: 'ya_devengado' }),
    ]);
    expect(avisos[1].detalle).toBe(
      '2026-03 a 2026-04: Ya devengado (2 aval·mes); no se repite (idempotente).',
    );
  });

  it('rango que cruza el año y sin avisos cuando todo se devenga', () => {
    const cruce = avisosDevengoAutomatico([mes('2025-12'), mes('2026-01')]);
    expect(cruce).toHaveLength(1);
    expect(cruce[0]).toMatchObject({
      desde: '2025-12',
      hasta: '2026-01',
      meses: 2,
      motivo: 'sin_avales',
      casos: 0,
    });
    expect(cruce[0].detalle).toBe(
      '2025-12 a 2026-01: Sin avales vivos con comisión; no había nada que devengar.',
    );
    expect(
      avisosDevengoAutomatico([
        mes('2026-01', { candidatos: 1, contabilizados: 1 }),
      ]),
    ).toEqual([]);
  });
});

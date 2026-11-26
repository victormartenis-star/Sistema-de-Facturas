import { describe, expect, it } from 'vitest';
import {
  ErrorBanca,
  asientoComisionBancaria,
  bicValido,
  comisionesAvalPrevistas,
  generarSepaXml,
  ibanValido,
  identificadorAcreedorSepa,
  normalizarHorizontes,
  planConciliacion,
  proyectarLiquidez,
  referenciaPartida,
  secuenciaAdeudo,
  sugerirConciliacion,
  textoSepa,
  totalRemesa,
  validarRemesaSepa,
  type CandidatoConciliacion,
  type DatosRemesaSepa,
  type FlujoLiquidez,
} from './banca';
import { can } from './capacidades';
import { transicion } from './maquina-estados';

const IBAN_A = 'ES91 2100 0418 4502 0005 1332';
const IBAN_B = 'ES7921000813610123456789';

const base = (): DatosRemesaSepa => ({
  tipo: 'transferencia',
  mensajeId: 'REM-2026-0001',
  creadoEl: '2026-11-26T10:15:00.000Z',
  fechaEjecucion: '2026-11-27',
  ordenante: {
    nombre: 'Construcciones Dintel, S.L.',
    nif: 'B12345674',
    iban: IBAN_A,
  },
  partidas: [
    {
      endToEndId: referenciaPartida('REM-2026-0001', 2),
      importe: '1210.50',
      nombre: 'Hormigones Peñíscola & Hijos',
      iban: IBAN_B,
      concepto: 'Factura F-77 <obra> Ávila',
    },
    {
      endToEndId: referenciaPartida('REM-2026-0001', 1),
      importe: 300,
      nombre: 'Ferralla Norte',
      iban: IBAN_B,
      bic: 'CAIXESBBXXX',
      concepto: 'Factura F-12',
    },
  ],
});

describe('remesas SEPA', () => {
  it('IBAN, BIC y texto SEPA', () => {
    expect(ibanValido(IBAN_A)).toBe(true);
    expect(ibanValido('ES9121000418450200051333')).toBe(false);
    expect(ibanValido('ES912100041845020005133')).toBe(false);
    expect(bicValido('CAIXESBBXXX')).toBe(true);
    expect(bicValido('CAIX')).toBe(false);
    expect(textoSepa('Peñíscola & Hijos «S.L.»', 70)).toBe(
      'Peniscola Hijos S.L.',
    );
  });

  it('identificador de acreedor con dígitos de control ISO 7064', () => {
    const id = identificadorAcreedorSepa('B12345674');
    expect(id).toMatch(/^ES\d{2}000B12345674$/);
    // Comprobación: NIF + ES + control ≡ 1 (mod 97).
    const num = `B12345674ES${id.slice(2, 4)}`.replace(/[A-Z]/g, (c) =>
      String(c.charCodeAt(0) - 55),
    );
    expect(BigInt(num) % 97n).toBe(1n);
    expect(() => identificadorAcreedorSepa('B1')).toThrow(ErrorBanca);
  });

  it('XML de transferencias determinista, ordenado y escapado', () => {
    const a = generarSepaXml(base(), '2026-11-26');
    const otra = base();
    otra.partidas.reverse();
    expect(generarSepaXml(otra, '2026-11-26')).toBe(a);
    expect(a).toContain('urn:iso:std:iso:20022:tech:xsd:pain.001.001.03');
    expect(a).toContain('<NbOfTxs>2</NbOfTxs>');
    expect(a).toContain('<CtrlSum>1510.50</CtrlSum>');
    expect(a).toContain('<CreDtTm>2026-11-26T10:15:00</CreDtTm>');
    expect(a).toContain('<IBAN>ES9121000418450200051332</IBAN>');
    expect(a).toContain('<Id>NOTPROVIDED</Id>');
    expect(a).toContain('<BIC>CAIXESBBXXX</BIC>');
    expect(a).toContain('<Nm>Hormigones Peniscola Hijos</Nm>');
    expect(a).not.toMatch(/<obra>|&lt;obra/);
    expect(a.indexOf('REM-2026-0001-0001')).toBeLessThan(
      a.indexOf('REM-2026-0001-0002'),
    );
    expect(totalRemesa(base().partidas)).toBe(151050n);
  });

  it('adeudos: un bloque por secuencia, mandato y acreedor', () => {
    const d = base();
    d.tipo = 'adeudo';
    d.acreedorId = identificadorAcreedorSepa('B12345674');
    d.partidas[0] = {
      ...d.partidas[0],
      mandato: 'MND-1',
      fechaMandato: '2025-01-10',
      secuencia: secuenciaAdeudo(0),
    };
    d.partidas[1] = {
      ...d.partidas[1],
      mandato: 'MND-2',
      fechaMandato: '2024-03-01',
      secuencia: secuenciaAdeudo(4),
    };
    const x = generarSepaXml(d, '2026-11-26');
    expect(x).toContain('pain.008.001.02');
    expect(x).toContain('<SeqTp>FRST</SeqTp>');
    expect(x).toContain('<SeqTp>RCUR</SeqTp>');
    expect(x.indexOf('-FRST')).toBeLessThan(x.indexOf('-RCUR'));
    expect(x).toContain(
      '<MndtId>MND-1</MndtId><DtOfSgntr>2025-01-10</DtOfSgntr>',
    );
    expect(x).toContain(`<Id>${d.acreedorId}</Id><SchmeNm>`);
  });

  it('valida datos obligatorios y rechaza con la lista de errores', () => {
    const d = base();
    d.tipo = 'adeudo';
    d.fechaEjecucion = '2026-11-20';
    d.partidas[0] = { ...d.partidas[0], iban: 'ES00', importe: 0 };
    d.partidas[1] = { ...d.partidas[1], endToEndId: d.partidas[0].endToEndId };
    const errores = validarRemesaSepa(d, '2026-11-26');
    const campos = errores.map((e) => e.campo);
    expect(campos).toEqual(
      expect.arrayContaining([
        'fechaEjecucion',
        'acreedorId',
        'iban',
        'importe',
        'mandato',
        'endToEndId',
      ]),
    );
    try {
      generarSepaXml(d, '2026-11-26');
      expect.unreachable();
    } catch (e) {
      expect((e as ErrorBanca).code).toBe('SEPA_DATA_INVALID');
      expect((e as ErrorBanca).detalle?.errores).toHaveLength(errores.length);
    }
  });

  it('ciclo de la remesa', () => {
    expect(transicion('sepa_remittance', 'borrador', 'generada')).toBe(
      'generada',
    );
    expect(transicion('sepa_remittance', 'generada', 'remitida')).toBe(
      'remitida',
    );
    expect(() =>
      transicion('sepa_remittance', 'remitida', 'anulada'),
    ).toThrow();
    expect(() =>
      transicion('sepa_remittance', 'anulada', 'generada'),
    ).toThrow();
  });
});

describe('conciliación asistida', () => {
  const cand = (c: Partial<CandidatoConciliacion>): CandidatoConciliacion => ({
    tipo: 'vencimiento',
    id: 'v1',
    importe: '1000.00',
    signo: 1,
    fecha: '2026-11-20',
    referencias: ['FV-2026-0007'],
    tercero: 'Promociones Atalaya',
    descripcion: 'FV-2026-0007',
    ...c,
  });

  it('puntúa importe, fecha, referencia y tercero; descarta sentido contrario', () => {
    const s = sugerirConciliacion(
      {
        importe: 1000,
        fecha: '2026-11-21',
        concepto: 'TRANSF PROMOCIONES ATALAYA FV-2026-0007',
      },
      [
        cand({}),
        cand({ id: 'v2', referencias: [], tercero: null, fecha: '2026-11-01' }),
        cand({ id: 'v3', signo: -1 }),
        cand({ id: 'v4', importe: 500, referencias: [], tercero: null }),
      ],
    );
    expect(s.map((x) => x.id)).toEqual(['v1', 'v2']);
    expect(s[0].confianza).toBe('alta');
    expect(s[0].puntuacion).toBe(99);
    expect(s[0].motivos).toContain('importe exacto');
  });

  it('sugiere con comisión implícita dentro de tolerancia (abono neto y cargo bruto)', () => {
    const abono = sugerirConciliacion(
      { importe: '995.00', fecha: '2026-11-20', concepto: 'ABONO' },
      [cand({ referencias: [] })],
    );
    expect(abono[0].comision).toBe(5);
    const cargo = sugerirConciliacion(
      {
        importe: '-1003.50',
        fecha: '2026-11-20',
        concepto: 'REMESA REM-2026-0001',
      },
      [cand({ tipo: 'remesa', signo: -1, referencias: ['REM-2026-0001'] })],
    );
    expect(cargo[0].comision).toBe(3.5);
    // Más de 50 € no es comisión: solo con referencia se sugiere, sin comisión.
    const lejos = sugerirConciliacion(
      { importe: '900', fecha: '2026-11-20', concepto: 'X' },
      [cand({ referencias: [] })],
    );
    expect(lejos).toEqual([]);
  });

  it('cuadre exacto con comisión y errores semánticos', () => {
    expect(
      planConciliacion({
        movimiento: '995',
        signoEsperado: 1,
        comision: 5,
        objetivo: 1000,
        exacto: false,
      }),
    ).toEqual({ bruto: 100000n, comision: 500n });
    expect(
      planConciliacion({
        movimiento: '-1003.5',
        signoEsperado: -1,
        comision: 3.5,
        objetivo: 1000,
        exacto: true,
      }).bruto,
    ).toBe(100000n);
    const codigo = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as ErrorBanca).code;
      }
      return null;
    };
    expect(
      codigo(() =>
        planConciliacion({
          movimiento: -10,
          signoEsperado: 1,
          objetivo: 10,
          exacto: true,
        }),
      ),
    ).toBe('BANK_MOVEMENT_DIRECTION_MISMATCH');
    expect(
      codigo(() =>
        planConciliacion({
          movimiento: -10,
          signoEsperado: -1,
          comision: 10,
          objetivo: 10,
          exacto: true,
        }),
      ),
    ).toBe('BANK_FEE_INVALID');
    expect(
      codigo(() =>
        planConciliacion({
          movimiento: -990,
          signoEsperado: -1,
          objetivo: 1000,
          exacto: true,
        }),
      ),
    ).toBe('BANK_DIFFERENCE_MISMATCH');
    expect(
      codigo(() =>
        planConciliacion({
          movimiento: 1200,
          signoEsperado: 1,
          objetivo: 1000,
          exacto: false,
        }),
      ),
    ).toBe('BANK_DIFFERENCE_MISMATCH');
    expect(asientoComisionBancaria('3.50', 'Comisión')).toEqual([
      {
        cuenta: '6260',
        debe: '3.50',
        haber: '0.00',
        projectId: null,
        concepto: 'Comisión',
      },
      {
        cuenta: '5720',
        debe: '0.00',
        haber: '3.50',
        projectId: null,
        concepto: 'Comisión',
      },
    ]);
  });
});

describe('previsión de liquidez', () => {
  it('horizontes acumulados, atrasados, mínimo diario y semanas, sin mutar', () => {
    const flujos: FlujoLiquidez[] = [
      { fecha: '2026-11-20', importe: '100.10', categoria: 'cobros' },
      { fecha: '2026-11-28', importe: -1500, categoria: 'pagos' },
      { fecha: '2026-12-05', importe: '0.20', categoria: 'talones' },
      { fecha: '2026-12-20', importe: 2000, categoria: 'certificaciones' },
      { fecha: '2027-06-01', importe: -99, categoria: 'compras' },
    ];
    const copia = structuredClone(flujos);
    const p = proyectarLiquidez({
      desde: '2026-11-26',
      horizontes: [30, 7],
      saldoInicial: '1000.00',
      flujos,
    });
    expect(flujos).toEqual(copia);
    expect(p.atrasados).toEqual({ entradas: 100.1, salidas: 0 });
    const [h7, h30] = p.horizontes;
    expect(h7).toMatchObject({
      dias: 7,
      hasta: '2026-12-03',
      entradas: 100.1,
      salidas: 1500,
      saldoFinal: -399.9,
      tension: true,
      saldoMinimo: -399.9,
      fechaMinimo: '2026-11-28',
    });
    expect(h30).toMatchObject({
      entradas: 2100.3,
      salidas: 1500,
      saldoFinal: 1600.3,
      saldoMinimo: -399.9,
    });
    expect(h30.porCategoria.certificaciones.entradas).toBe(2000);
    expect(p.semanas).toHaveLength(5);
    expect(p.semanas[p.semanas.length - 1].saldo).toBe(1600.3);
  });

  it('horizontes por defecto y no válidos', () => {
    expect(normalizarHorizontes(undefined)).toEqual([7, 30, 60, 90]);
    expect(normalizarHorizontes('90, 7,7')).toEqual([7, 90]);
    expect(() => normalizarHorizontes('0')).toThrow(ErrorBanca);
    expect(() => normalizarHorizontes('1,2,3,4,5,6,7,8,9')).toThrow(ErrorBanca);
  });

  it('comisiones de aval previstas por período hasta el vencimiento', () => {
    const c = comisionesAvalPrevistas({
      emision: '2026-01-15',
      vencimiento: '2027-01-15',
      periodoMeses: 3,
      tasaAnualPct: '1.0000',
      saldoVivo: 100_000,
      desde: '2026-05-01',
      hasta: '2027-03-01',
    });
    expect(c).toEqual([
      { fecha: '2026-07-15', importe: 250 },
      { fecha: '2026-10-15', importe: 250 },
    ]);
    expect(
      comisionesAvalPrevistas({
        emision: '2026-01-15',
        vencimiento: null,
        periodoMeses: null,
        tasaAnualPct: null,
        saldoVivo: 1,
        desde: '2026-01-01',
        hasta: '2027-01-01',
      }),
    ).toEqual([]);
  });

  it('permisos: banca solo para admin, gerente y administración', () => {
    expect(can('administracion', 'crear', 'banca')).toBe(true);
    expect(can('obra', 'crear', 'banca')).toBe(false);
    expect(can('lector', 'crear', 'banca')).toBe(false);
  });
});

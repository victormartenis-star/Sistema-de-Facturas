import { describe, expect, it } from 'vitest';
import {
  matchCandidates,
  parseBankCsv,
  parseNorma43,
  type MilestoneForMatching,
} from './bank-reconciliation';

describe('parseBankCsv', () => {
  it('parsea un CSV con cabecera en español, coma como delimitador', () => {
    const csv = [
      'fecha,concepto,importe,saldo',
      '2024-01-15,Certificacion obra A1,1500.00,5000.00',
      '20/01/2024,Pago proveedor,-250.75,4749.25',
    ].join('\n');

    const rows = parseBankCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      transactionDate: '2024-01-15',
      amount: 1500,
      concept: 'Certificacion obra A1',
      balanceAfter: 5000,
      bankReference: null,
    });
    expect(rows[1].transactionDate).toBe('2024-01-20');
    expect(rows[1].amount).toBe(-250.75);
  });

  it('admite `;` como delimitador y coma decimal española (miles con punto)', () => {
    const csv = [
      'fecha;concepto;importe;saldo',
      '15/01/2024;Ingreso;1.500,50;10.000,00',
    ].join('\n');

    const rows = parseBankCsv(csv);
    expect(rows[0].amount).toBe(1500.5);
    expect(rows[0].balanceAfter).toBe(10000);
  });

  it('rechaza un CSV sin las columnas mínimas', () => {
    const csv = 'a,b\n1,2';
    expect(() => parseBankCsv(csv)).toThrow(/columnas/);
  });

  it('devuelve vacío para texto vacío', () => {
    expect(parseBankCsv('')).toEqual([]);
  });
});

describe('parseNorma43', () => {
  // Fichero construido a mano según la disposición de campos publicada del
  // estándar AEB43 — no validado contra un extracto real de banco (ver
  // comentario de `parseNorma43` en bank-reconciliation.ts).
  const movimiento1 =
    '22' + // tipo
    '0182' + // entidad
    '0001' + // oficina
    '240115' + // fecha operación
    '240115' + // fecha valor
    '01' + // concepto común
    '001' + // concepto propio
    '2' + // haber (cobro)
    '00000000150000' + // importe 1500.00 (14 dígitos, 2 decimales implícitos)
    'DOC00001' + // documento
    'PAGO CERTIFICACION OBRA A1   '; // concepto ampliado (30)
  const continuacion = '23  REF ADICIONAL 12345';
  const movimiento2 =
    '22' +
    '0182' +
    '0001' +
    '240120' +
    '240120' +
    '01' +
    '001' +
    '1' + // debe (pago)
    '00000000025075' + // importe 250.75
    'DOC00002' +
    'PAGO PROVEEDOR                ';
  const cierre = '33' + '0'.repeat(78);

  it('parsea movimientos, junta el concepto ampliado del registro 23 y distingue debe/haber', () => {
    const texto = [
      '11' + '0'.repeat(78),
      movimiento1,
      continuacion,
      movimiento2,
      cierre,
    ].join('\n');

    const rows = parseNorma43(texto);
    expect(rows).toHaveLength(2);

    expect(rows[0].transactionDate).toBe('2024-01-15');
    expect(rows[0].amount).toBe(1500);
    expect(rows[0].concept).toBe(
      'PAGO CERTIFICACION OBRA A1 REF ADICIONAL 12345',
    );
    expect(rows[0].bankReference).toBe('DOC00001');

    expect(rows[1].transactionDate).toBe('2024-01-20');
    expect(rows[1].amount).toBe(-250.75);
    expect(rows[1].concept).toBe('PAGO PROVEEDOR');
  });

  it('devuelve vacío si no hay registros de movimiento', () => {
    expect(parseNorma43('11' + '0'.repeat(78))).toEqual([]);
  });
});

describe('matchCandidates', () => {
  const cobro: MilestoneForMatching = {
    id: 'm-cobro',
    amount: 1500,
    dueDate: '2024-01-14',
    direction: 'cobro',
  };
  const pago: MilestoneForMatching = {
    id: 'm-pago',
    amount: 250.75,
    dueDate: '2024-01-19',
    direction: 'pago',
  };

  it('sugiere alta confianza con mismo importe y fecha cercana', () => {
    const candidates = matchCandidates(
      { amount: 1500, transactionDate: '2024-01-15' },
      [cobro, pago],
    );
    expect(candidates).toEqual([
      { milestoneId: 'm-cobro', confidence: 'alta', daysDiff: 1 },
    ]);
  });

  it('no sugiere un vencimiento de sentido contrario aunque el importe coincida', () => {
    // Transacción positiva (cobro) contra un vencimiento de pago del mismo importe.
    const candidates = matchCandidates(
      { amount: 250.75, transactionDate: '2024-01-19' },
      [pago],
    );
    expect(candidates).toEqual([]);
  });

  it('rebaja la confianza cuanto más lejos está la fecha, y descarta fuera de ±30 días', () => {
    const lejos: MilestoneForMatching = {
      id: 'm-lejos',
      amount: 1500,
      dueDate: '2023-12-20', // 26 días antes → dentro de la ventana, confianza baja
      direction: 'cobro',
    };
    const fueraDeVentana: MilestoneForMatching = {
      id: 'm-fuera',
      amount: 1500,
      dueDate: '2023-11-01', // >30 días → descartado
      direction: 'cobro',
    };
    const candidates = matchCandidates(
      { amount: 1500, transactionDate: '2024-01-15' },
      [lejos, fueraDeVentana],
    );
    expect(candidates).toEqual([
      { milestoneId: 'm-lejos', confidence: 'baja', daysDiff: 26 },
    ]);
  });

  it('no sugiere si el importe no coincide (tolerancia de 1 céntimo)', () => {
    const candidates = matchCandidates(
      { amount: 1500.02, transactionDate: '2024-01-15' },
      [cobro],
    );
    expect(candidates).toEqual([]);
  });
});

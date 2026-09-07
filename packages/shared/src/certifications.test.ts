import { describe, expect, it } from 'vitest';
import { certificationWarnings } from './certifications';
import { computeCertification } from './calculo';

const CONTRATO = 1_850_000;
/** Contrato más un modificado aprobado de 120.000 €. */
const ACTUALIZADO = 1_970_000;

const cert = (
  seq: number,
  budgetBase: number | null,
  status: 'borrador' | 'facturada' = 'facturada',
) => ({ seq, budgetBase, status });

describe('certificar a origen sobre el presupuesto vigente', () => {
  it('el mismo % sobre el presupuesto actualizado certifica más', () => {
    // Es el fallo que esto persigue: con un modificado aprobado, aplicar el %
    // al contrato inicial certifica de menos y no lo delata nada, porque el
    // porcentaje que se teclea es el correcto.
    const conContrato = computeCertification(CONTRATO, 40, 0, 5);
    const conActualizado = computeCertification(ACTUALIZADO, 40, 0, 5);
    expect(conContrato.cumulativeAmount).toBe(740_000);
    expect(conActualizado.cumulativeAmount).toBe(788_000);
    expect(conActualizado.cumulativeAmount - conContrato.cumulativeAmount).toBe(
      48_000,
    );
  });

  it('el modificado entra a origen: el periodo recupera lo no certificado', () => {
    // Hasta el 36,49 % se certificó sobre el contrato; al aprobarse el
    // modificado, la siguiente se calcula sobre la base nueva y la diferencia
    // sale en el importe del periodo, sin tener que rehacer nada.
    const anterior = computeCertification(CONTRATO, 36.49, 0, 5);
    const siguiente = computeCertification(
      ACTUALIZADO,
      40,
      anterior.cumulativeAmount,
      5,
    );
    expect(anterior.cumulativeAmount).toBe(675_065);
    expect(siguiente.cumulativeAmount).toBe(788_000);
    expect(siguiente.periodAmount).toBe(112_935);
  });
});

describe('certificationWarnings', () => {
  it('sin modificados y con la base guardada no hay nada que decir', () => {
    expect(
      certificationWarnings([cert(1, CONTRATO)], CONTRATO, CONTRATO),
    ).toEqual([]);
  });

  it('avisa de que se certifica sobre el presupuesto actualizado', () => {
    const w = certificationWarnings(
      [cert(1, ACTUALIZADO)],
      ACTUALIZADO,
      CONTRATO,
    ).join(' ');
    expect(w).toContain('1.970.000,00 €');
    expect(w).toContain('1.850.000,00 €');
    expect(w).toContain('aprobados por la Dirección Facultativa');
  });

  it('avisa del salto que va a dar el acumulado tras aprobar un modificado', () => {
    const w = certificationWarnings(
      [cert(1, CONTRATO), cert(2, CONTRATO)],
      ACTUALIZADO,
      CONTRATO,
    ).join(' ');
    expect(w).toContain('120.000,00 €');
    expect(w).toContain('certificación nº 2');
    expect(w).toContain('No es un error');
  });

  it('toma la última por número, no por orden de llegada', () => {
    const w = certificationWarnings(
      [cert(3, ACTUALIZADO), cert(1, CONTRATO)],
      ACTUALIZADO,
      CONTRATO,
    ).join(' ');
    expect(w).not.toContain('certificación nº 3');
  });

  it('avisa de las certificaciones antiguas sin base guardada', () => {
    const w = certificationWarnings(
      [cert(1, null), cert(2, ACTUALIZADO)],
      ACTUALIZADO,
      CONTRATO,
    ).join(' ');
    expect(w).toContain('1 certificación(es) anteriores');
    expect(w).toContain('revisa a mano');
  });

  it('sin modificados, una base sin guardar no es un problema', () => {
    // El contrato no ha cambiado: la base era necesariamente el contrato.
    const w = certificationWarnings([cert(1, null)], CONTRATO, CONTRATO);
    expect(w).toEqual([]);
  });

  it('una obra sin certificaciones no genera avisos', () => {
    expect(certificationWarnings([], ACTUALIZADO, CONTRATO)).toEqual([]);
  });
});

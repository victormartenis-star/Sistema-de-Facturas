import { describe, expect, it } from 'vitest';
import {
  checkTaxId,
  cifControl,
  dniLetter,
  isValidTaxId,
  normalizeTaxId,
  taxIdWarning,
} from './fiscal';

describe('normalizeTaxId', () => {
  it('quita espacios, puntos y guiones y sube a mayúsculas', () => {
    expect(normalizeTaxId(' b-12.345 674 ')).toBe('B12345674');
  });
});

describe('NIF de persona física', () => {
  it('acepta un DNI con su letra', () => {
    expect(dniLetter(12345678)).toBe('Z');
    expect(isValidTaxId('12345678Z')).toBe(true);
  });

  it('rechaza la letra equivocada y dice cuál era', () => {
    const c = checkTaxId('12345678A');
    expect(c.valid).toBe(false);
    expect(c.kind).toBe('nif');
    expect(c.reason).toContain('le corresponde la Z');
  });

  it('acepta el DNI escrito con guion', () => {
    expect(isValidTaxId('12345678-Z')).toBe(true);
  });
});

describe('NIE', () => {
  it('acepta un NIE válido', () => {
    // X0000000 → el 0 tiene letra T.
    expect(isValidTaxId('X0000000T')).toBe(true);
  });

  it('la inicial cuenta como 0, 1 o 2', () => {
    // Y0000000 se evalúa como 10000000.
    expect(checkTaxId('Y0000000Z').kind).toBe('nie');
    expect(isValidTaxId('Y0000000Z')).toBe(dniLetter(10000000) === 'Z');
  });

  it('rechaza el NIE con letra mal', () => {
    const c = checkTaxId('X0000000A');
    expect(c.valid).toBe(false);
    expect(c.reason).toContain('NIE');
  });
});

describe('CIF', () => {
  it('calcula el dígito de control', () => {
    expect(cifControl('A', '5881850')).toBe('1');
    expect(cifControl('B', '1234567')).toBe('4');
  });

  it('acepta un CIF con dígito de control correcto', () => {
    expect(isValidTaxId('A58818501')).toBe(true);
    expect(isValidTaxId('B12345674')).toBe(true);
  });

  it('rechaza el CIF con el control cambiado y dice el correcto', () => {
    const c = checkTaxId('B12345671');
    expect(c.valid).toBe(false);
    expect(c.kind).toBe('cif');
    expect(c.reason).toContain('le corresponde 4');
  });

  it('los tipos K, P, Q, R, S, N y W llevan letra de control', () => {
    // P: entidad pública. El control es la letra del dígito calculado.
    const digito = Number(cifControl('B', '1234567'));
    expect(cifControl('P', '1234567')).toBe('JABCDEFGHI'[digito]);
  });

  it('los tipos A, B, E y H llevan dígito', () => {
    expect(/^\d$/.test(cifControl('A', '1234567'))).toBe(true);
    expect(/^\d$/.test(cifControl('H', '1234567'))).toBe(true);
  });

  it('los que admiten ambos aceptan el dígito o su letra', () => {
    // J: sociedad civil. Vale J1234567D y J12345674.
    const digito = Number(cifControl('J', '1234567'));
    const letra = 'JABCDEFGHI'[digito];
    expect(isValidTaxId(`J1234567${digito}`)).toBe(true);
    expect(isValidTaxId(`J1234567${letra}`)).toBe(true);
  });

  it('una letra inicial que no existe como forma jurídica no es CIF', () => {
    // I no es una forma jurídica: cae en extranjero, no se inventa un error.
    expect(checkTaxId('I12345674').kind).toBe('extranjero');
  });
});

describe('identificadores extranjeros', () => {
  it('se aceptan pero se marcan como no comprobados', () => {
    const c = checkTaxId('PT501442600');
    expect(c.kind).toBe('extranjero');
    expect(c.valid).toBe(true);
    expect(c.verified).toBe(false);
  });

  it('no se bloquea a un proveedor legítimo de fuera', () => {
    // Rechazar aquí sería el error caro: dejaría fuera a proveedores reales
    // por no tener un algoritmo con el que comprobarlos.
    expect(isValidTaxId('FR40303265045')).toBe(true);
  });
});

describe('vacío', () => {
  it('un NIF vacío no es válido', () => {
    const c = checkTaxId('   ');
    expect(c.valid).toBe(false);
    expect(c.kind).toBeNull();
  });
});

describe('taxIdWarning', () => {
  it('sin NIF avisa de que no se puede cruzar con el REA', () => {
    expect(taxIdWarning(null)).toContain('REA');
    expect(taxIdWarning('')).toContain('REA');
  });

  it('con un NIF mal lo dice y da el correcto', () => {
    const w = taxIdWarning('B12345671');
    expect(w).toContain('NIF incorrecto');
    expect(w).toContain('le corresponde 4');
  });

  it('con uno extranjero pide comprobarlo a mano', () => {
    expect(taxIdWarning('PT501442600')).toContain('a mano');
  });

  it('con uno correcto no dice nada', () => {
    expect(taxIdWarning('B12345674')).toBeNull();
  });
});

describe('normalización y unicidad', () => {
  it('las formas con puntos y guiones colapsan en la misma', () => {
    // Si no colapsaran, el índice de unicidad vería dos NIF distintos y
    // admitiría dos veces la misma empresa.
    const formas = ['B12345674', 'B-12.345.674', 'b 12 345 674', 'B/12345674'];
    const normalizadas = new Set(formas.map(normalizeTaxId));
    expect(normalizadas).toEqual(new Set(['B12345674']));
  });
});
